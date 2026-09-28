/**
 * OpenRouter model client (BYOK).
 *
 * Two things matter here beyond "call an API":
 *
 * 1. STREAMING. Token streaming from a model is wall time, not CPU time — the
 *    isolate is idle while the socket is open. That is why a Durable Object can
 *    afford a long agent turn even on the Workers Free tier. Do not replace
 *    this with a buffered request without re-measuring.
 *
 * 2. TOOL CALLING IS A HARD REQUIREMENT. A model without function calling
 *    cannot be the primary. OpenRouter normalises tool schemas across
 *    providers, but some small models silently ignore them — so a response with
 *    no tool_calls where we expected one is surfaced, not swallowed.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface StreamHandlers {
  onText?: (delta: string, accumulated: string) => void;
  onToolCall?: (call: ToolCall) => void;
}

export interface CompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  model: string;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class ModelError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

interface ModelEnv {
  OPENROUTER_API_KEY?: string;
}

export class ModelClient {
  constructor(private env: ModelEnv) {}

  private requireKey(): string {
    const key = this.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new ModelError(
        'OPENROUTER_API_KEY is not set on the Worker. Set it with: wrangler secret put OPENROUTER_API_KEY',
        'NO_API_KEY',
        503,
      );
    }
    return key;
  }

  /**
   * Stream a completion, invoking handlers as content and tool calls arrive.
   * Resolves with the final assistant message plus usage.
   *
   * The returned `content` is the concatenation of all text deltas. When the
   * model emits tool calls, text is usually empty — that is not an error.
   */
  async streamCompletion(
    opts: {
      model: string;
      messages: ChatMessage[];
      tools?: ToolSchema[];
      temperature?: number;
      maxTokens?: number;
      signal?: AbortSignal;
    },
    handlers: StreamHandlers = {},
  ): Promise<{ message: ChatMessage; usage: CompletionUsage }> {
    const key = this.requireKey();

    if (!opts.model) {
      throw new ModelError(
        'No model configured. Set one in Settings → Autonomy → Model routing.',
        'NO_MODEL',
        503,
      );
    }

    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map(serializeToolCall) } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      stream: true,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 4096,
    };

    if (opts.tools?.length) body.tools = opts.tools;

    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'ThreadMyMail',
        'HTTP-Referer': 'https://threadmymail.workers.dev',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ModelError(
        `Model request failed (${res.status}): ${truncate(detail, 300)}`,
        'MODEL_ERROR',
        res.status === 429 ? 429 : 502,
      );
    }

    return this.consumeStream(res, handlers);
  }

  private async consumeStream(
    res: Response,
    handlers: StreamHandlers,
  ): Promise<{ message: ChatMessage; usage: CompletionUsage }> {
    const reader = res.body?.getReader();
    if (!reader) {
      throw new ModelError('Model response had no body.', 'NO_BODY', 502);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage: CompletionUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      model: '',
    };

    // Tool calls arrive fragmented across chunks and are keyed by index, so they
    // must be accumulated before being dispatched.
    const pending = new Map<number, { id: string; name: string; args: string }>();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        let split: number;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);

          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;

            let parsed: OpenRouterChunk;
            try {
              parsed = JSON.parse(data) as OpenRouterChunk;
            } catch {
              continue; // Malformed frame — skip rather than kill the stream.
            }

            if (parsed.error) {
              throw new ModelError(parsed.error.message, 'MODEL_ERROR', 502);
            }

            if (parsed.usage) {
              usage = {
                promptTokens: parsed.usage.prompt_tokens ?? 0,
                completionTokens: parsed.usage.completion_tokens ?? 0,
                totalTokens: parsed.usage.total_tokens ?? 0,
                costUsd: Number(parsed.usage.cost ?? 0),
                model: parsed.model || usage.model,
              };
            }

            const delta = parsed.choices?.[0]?.delta;
            if (!delta) continue;

            if (typeof delta.content === 'string' && delta.content) {
              content += delta.content;
              handlers.onText?.(delta.content, content);
            }

            for (const tc of delta.tool_calls ?? []) {
              const slot = pending.get(tc.index) ?? { id: '', name: '', args: '' };
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name = tc.function.name;
              if (tc.function?.arguments) slot.args += tc.function.arguments;
              pending.set(tc.index, slot);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const toolCalls: ToolCall[] = [];
    for (const [index, slot] of pending) {
      if (!slot.name) continue;
      let args: Record<string, unknown> = {};
      if (slot.args) {
        try {
          args = JSON.parse(slot.args) as Record<string, unknown>;
        } catch {
          throw new ModelError(
            `Tool "${slot.name}" had unparseable arguments: ${truncate(slot.args, 200)}`,
            'BAD_TOOL_ARGS',
            502,
          );
        }
      }
      const call: ToolCall = {
        id: slot.id || `call_${index}`,
        name: slot.name,
        arguments: args,
      };
      toolCalls.push(call);
      handlers.onToolCall?.(call);
    }

    const message: ChatMessage = {
      role: 'assistant',
      content,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };

    return { message, usage };
  }

  /** Non-streaming single call. Used for background/batch work with no UI. */
  async complete(opts: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    tools?: ToolSchema[];
    signal?: AbortSignal;
  }): Promise<{ message: ChatMessage; usage: CompletionUsage }> {
    let accumulated = '';
    const calls: ToolCall[] = [];
    const result = await this.streamCompletion(opts, {
      onText: (_d, all) => {
        accumulated = all;
      },
      onToolCall: (c) => calls.push(c),
    });
    void accumulated;
    return result;
  }
}

interface OpenRouterChunk {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message: string };
}

function serializeToolCall(call: ToolCall) {
  return {
    id: call.id,
    type: 'function' as const,
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
