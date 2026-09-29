/**
 * Provider-aware model client (BYOK).
 *
 * Three things matter here beyond "call an API":
 *
 * 1. STREAMING. Token streaming from a model is wall time, not CPU time — the
 *    isolate is idle while the socket is open. That is why a Durable Object can
 *    afford a long agent turn even on the Workers Free tier. Do not replace
 *    this with a buffered request without re-measuring.
 *
 * 2. TOOL CALLING IS A HARD REQUIREMENT. A model without function calling
 *    cannot be the primary. Tool schemas are translated per dialect, because
 *    Anthropic names the JSON Schema field `input_schema` and takes the system
 *    prompt out of band.
 *
 * 3. THE CREDENTIAL IS THE USER'S, NOT THE WORKER'S. Every request carries a key
 *    decrypted for one user, and the message for a missing key points at
 *    Settings — never at `wrangler secret put`, which is not how this product
 *    is configured.
 */

import { providerSpec, type ProviderDialect } from './providers.js';

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

/** Everything needed to issue one request. Built by the caller, per user. */
export interface ModelTarget {
  provider: string;
  model: string;
  /** Resolved, validated base URL with no trailing slash. */
  baseUrl: string;
  /** Null is allowed only for loopback providers that need no key. */
  apiKey: string | null;
}

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

export class ModelClient {
  /**
   * `maxOutputTokens` caps what we ask for on the smoke test so a misconfigured
   * provider cannot bill an unbounded completion.
   */
  constructor(private readonly limits: { maxOutputTokens?: number } = {}) {}

  /**
   * Stream a completion, invoking handlers as content and tool calls arrive.
   * Resolves with the final assistant message plus usage.
   *
   * The returned `content` is the concatenation of all text deltas. When the
   * model emits tool calls, text is usually empty — that is not an error.
   */
  async streamCompletion(
    opts: {
      target: ModelTarget;
      messages: ChatMessage[];
      tools?: ToolSchema[];
      temperature?: number;
      maxTokens?: number;
      signal?: AbortSignal;
    },
    handlers: StreamHandlers = {},
  ): Promise<{ message: ChatMessage; usage: CompletionUsage }> {
    const spec = providerSpec(opts.target.provider);
    if (!spec) {
      throw new ModelError(
        `Unknown model provider "${opts.target.provider}". Pick one in Settings.`,
        'UNKNOWN_PROVIDER',
        400,
      );
    }
    if (!opts.target.model) {
      throw new ModelError(
        `No model selected for provider "${spec.label}". Choose one in Settings.`,
        'NO_MODEL',
        503,
      );
    }
    if (opts.target.apiKey === null && !spec.local) {
      throw new ModelError(
        `No ${spec.label} API key saved. Add one in Settings → Model routing.`,
        'NO_API_KEY',
        503,
      );
    }

    const res =
      spec.dialect === 'anthropic'
        ? await this.requestAnthropic(opts)
        : await this.requestOpenAI(opts);

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ModelError(
        `${spec.label} request failed (${res.status}): ${truncate(detail, 300)}`,
        'MODEL_ERROR',
        res.status === 429 ? 429 : 502,
      );
    }

    return spec.dialect === 'anthropic'
      ? this.consumeAnthropic(res, opts.target.model, handlers)
      : this.consumeOpenAI(res, opts.target.model, handlers);
  }

  /** Cap applied to every request so a bad config cannot run away. */
  private cap(requested: number | undefined): number {
    const requestedCap = this.limits.maxOutputTokens;
    if (requested === undefined) return requestedCap ?? 4096;
    return requestedCap === undefined ? requested : Math.min(requested, requestedCap);
  }

  // ── OpenAI-compatible dialect ─────────────────────────────────────────────

  private async requestOpenAI(opts: {
    target: ModelTarget;
    messages: ChatMessage[];
    tools?: ToolSchema[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<Response> {
    const body: Record<string, unknown> = {
      model: opts.target.model,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map(serializeToolCall) } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      stream: true,
      temperature: opts.temperature ?? 0.4,
      max_tokens: this.cap(opts.maxTokens),
      // Without this most providers omit usage on a streamed response, and the
      // budget checks in config.ts would then always read zero.
      stream_options: { include_usage: true },
    };
    if (opts.tools?.length) body.tools = opts.tools;

    return fetch(`${opts.target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...(opts.target.apiKey ? { Authorization: `Bearer ${opts.target.apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  }

  // ── Anthropic Messages dialect ─────────────────────────────────────────────

  private async requestAnthropic(opts: {
    target: ModelTarget;
    messages: ChatMessage[];
    tools?: ToolSchema[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<Response> {
    // Anthropic takes the system prompt out of band and has no 'system' role in
    // the message list, so it is split out here rather than in the loop.
    const system = opts.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const messages = opts.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role !== 'assistant' || !m.tool_calls?.length) {
          return { role: m.role, content: m.content };
        }
        // Assistant turns become a content block array when they carry tool_use.
        return {
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.tool_calls.map((c) => ({
              type: 'tool_use',
              id: c.id,
              name: c.name,
              input: c.arguments,
            })),
          ],
        };
      })
      .map((m) => {
        if (typeof m.content === 'string' || m.role !== 'user') return m;
        return {
          role: 'user',
          content: (m.content as Array<Record<string, unknown>>).map((block) => {
            if (block['type'] === 'tool_result') {
              const { type: _t, ...rest } = block;
              void _t;
              return { type: 'tool_result', ...rest };
            }
            return block;
          }),
        };
      });

    const body: Record<string, unknown> = {
      model: opts.target.model,
      max_tokens: this.cap(opts.maxTokens),
      temperature: opts.temperature ?? 0.4,
      messages,
      stream: true,
    };
    if (system !== '') body.system = system;
    if (opts.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    return fetch(`${opts.target.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': opts.target.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  }

  // ── Stream consumption ────────────────────────────────────────────────────

  private async consumeOpenAI(
    res: Response,
    model: string,
    handlers: StreamHandlers,
  ): Promise<{ message: ChatMessage; usage: CompletionUsage }> {
    const { events, done } = await readSse(res);

    let content = '';
    let usage: CompletionUsage = emptyUsage(model);
    const pending = new Map<number, { id: string; name: string; args: string }>();

    for (const data of events) {
      if (data === '[DONE]') continue;

      let parsed: OpenAIChunk;
      try {
        parsed = JSON.parse(data) as OpenAIChunk;
      } catch {
        continue; // Malformed frame — skip rather than kill the stream.
      }
      if (parsed.error) throw new ModelError(parsed.error.message, 'MODEL_ERROR', 502);

      if (parsed.usage) {
        usage = {
          promptTokens: parsed.usage.prompt_tokens ?? 0,
          completionTokens: parsed.usage.completion_tokens ?? 0,
          totalTokens: parsed.usage.total_tokens ?? 0,
          // Most OpenAI-compatible providers report no cost. Zero is honest;
          // inventing a price from memory would be worse than not reporting one.
          costUsd: Number(parsed.usage.cost ?? 0),
          model: parsed.model || model,
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

    const toolCalls = drainToolCalls(pending, handlers);
    return {
      message: {
        role: 'assistant',
        content,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      usage,
    };
  }

  private async consumeAnthropic(
    res: Response,
    model: string,
    handlers: StreamHandlers,
  ): Promise<{ message: ChatMessage; usage: CompletionUsage }> {
    const { events, done } = await readSse(res);

    let content = '';
    let usage: CompletionUsage = emptyUsage(model);
    // Anthropic streams tool input as partial JSON keyed by content block index,
    // so the pending map is reused with the index space shifted past text.
    const pending = new Map<number, { id: string; name: string; args: string }>();
    let currentToolIndex = -1;

    for (const data of events) {
      let parsed: AnthropicEvent;
      try {
        parsed = JSON.parse(data) as AnthropicEvent;
      } catch {
        continue;
      }
      if (parsed.type === 'error') {
        throw new ModelError(parsed.error?.message ?? 'Anthropic stream error', 'MODEL_ERROR', 502);
      }

      if (parsed.type === 'message_start') {
        const u = parsed.message?.usage;
        if (u) {
          usage = {
            promptTokens: u.input_tokens ?? 0,
            completionTokens: u.output_tokens ?? 0,
            totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
            costUsd: 0,
            model: parsed.message?.model ?? model,
          };
        }
        continue;
      }

      if (parsed.type === 'content_block_start') {
        const block = parsed.content_block;
        const index = parsed.index ?? 0;
        if (block?.type === 'tool_use') {
          currentToolIndex = index;
          pending.set(index, { id: block.id ?? '', name: block.name ?? '', args: '' });
        }
        continue;
      }

      if (parsed.type === 'content_block_delta') {
        const delta = parsed.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          content += delta.text;
          handlers.onText?.(delta.text, content);
        } else if (delta?.type === 'input_json_delta' && currentToolIndex >= 0) {
          const slot = pending.get(currentToolIndex);
          if (slot) slot.args += delta.partial_json ?? '';
        }
        continue;
      }

      if (parsed.type === 'message_delta' && parsed.usage) {
        const outputTokens = parsed.usage.output_tokens ?? usage.completionTokens;
        usage = {
          ...usage,
          completionTokens: outputTokens,
          totalTokens: usage.promptTokens + outputTokens,
        };
      }
    }

    void done;
    const toolCalls = drainToolCalls(pending, handlers);
    return {
      message: {
        role: 'assistant',
        content,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      usage,
    };
  }

  /** Non-streaming single call, for background work with no UI. */
  async complete(opts: {
    target: ModelTarget;
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    tools?: ToolSchema[];
    signal?: AbortSignal;
  }): Promise<{ message: ChatMessage; usage: CompletionUsage }> {
    return this.streamCompletion(opts, {});
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split an SSE body into `data:` payloads.
 *
 * Buffered here rather than with a reader loop because the loop is duplicated
 * across two dialects otherwise, and the buffer is bounded by MAX_SSE_BUFFER.
 */
async function readSse(res: Response): Promise<{ events: string[]; done: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) throw new ModelError('Model response had no body.', 'NO_BODY', 502);

  const decoder = new TextDecoder();
  const events: string[] = [];
  let buffer = '';
  let done = false;

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });

      let split: number;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data !== '') events.push(data);
        }
      }
      if (buffer.length > MAX_SSE_BUFFER) {
        throw new ModelError('Model stream produced an oversized frame.', 'BAD_STREAM', 502);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { events, done };
}

const MAX_SSE_BUFFER = 1_000_000;

function drainToolCalls(
  pending: Map<number, { id: string; name: string; args: string }>,
  handlers: StreamHandlers,
): ToolCall[] {
  const calls: ToolCall[] = [];
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
    const call: ToolCall = { id: slot.id || `call_${index}`, name: slot.name, arguments: args };
    calls.push(call);
    handlers.onToolCall?.(call);
  }
  return calls;
}

function emptyUsage(model: string): CompletionUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, model };
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

interface OpenAIChunk {
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

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string };
  message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message: string };
}

export type { ProviderDialect };
