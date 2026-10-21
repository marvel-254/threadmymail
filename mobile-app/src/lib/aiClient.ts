/**
 * AI client — the single outbound call to the user's BYOK provider.
 *
 * Everything else in the app is local; this is the one place a request leaves
 * the device. It talks OpenAI-compatible `/chat/completions` with `stream: true`
 * and parses the SSE response token by token. Anthropic's preset uses its native
 * Messages API because it is not OpenAI-compatible (different path, auth header,
 * and event shape), so the provider adapter lives here rather than leaking into
 * screens.
 *
 * The key comes from SecureStore via `providerStore`; it is never logged.
 */
import { getPrimaryProvider, type SavedProvider } from './providerStore';
import { getGuardrails } from './guardrails';

export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatStreamOptions = {
  messages: ChatMessage[];
  /** Funding tokens as they arrive; the full text is also returned. */
  onToken?: (token: string) => void;
  /** Abort from the Stop button. Partial text is returned as a success. */
  signal?: AbortSignal;
  maxTokens?: number;
};

export type ChatStreamResult =
  | { ok: true; text: string; aborted: boolean }
  | { ok: false; error: string; aborted: boolean };

const DEFAULT_MAX_TOKENS = 1024;

/**
 * Millo's identity and rules. Kept short because every token is the user's
 * money, but explicit about the product's one non-negotiable: the agent asks
 * before doing anything irreversible.
 */
export function buildSystemPrompt(): string {
  const { killSwitch, shadowMode } = getGuardrails();
  const guardrail = killSwitch
    ? 'The kill switch is ON: do not propose or take any autonomous action. You may still answer questions and draft text for the user to send manually.'
    : shadowMode
      ? 'Shadow mode is ON: describe what you would do, but never claim to have sent, moved, or deleted anything.'
      : 'Autonomous actions are currently allowed within the app, but always ask before sending, deleting, or moving mail.';

  return [
    'You are Millo, an email assistant running entirely on the user\'s phone.',
    'You help with reading mail, drafting replies, finding commitments and deadlines, and planning next steps.',
    'Be concise and practical. Never invent an email, sender, date, or commitment that is not in the conversation.',
    'You cannot read the mailbox by yourself in this chat: the user must paste or reference content.',
    'Before any action that sends, archives, deletes, or changes mail, state what you will do and wait for approval.',
    guardrail,
  ].join(' ');
}

function providerEndpoint(provider: SavedProvider): { url: string; anthropic: boolean } {
  const anthropic = provider.id === 'anthropic' || provider.baseUrl.includes('api.anthropic.com');
  return {
    url: anthropic ? `${provider.baseUrl}/messages` : `${provider.baseUrl}/chat/completions`,
    anthropic,
  };
}

function buildBody(
  provider: SavedProvider,
  messages: ChatMessage[],
  anthropic: boolean,
  maxTokens: number,
): Record<string, unknown> {
  if (!anthropic) {
    return {
      model: provider.model,
      messages,
      stream: true,
      max_tokens: maxTokens,
    };
  }

  // Anthropic requires the system prompt separate from the turn list and
  // alternating user/assistant roles. Merge any consecutive same-role turns.
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      turns.push({ role, content: message.content });
    }
  }

  return {
    model: provider.model,
    max_tokens: maxTokens,
    system: system || undefined,
    messages: turns,
    stream: true,
  };
}

function buildHeaders(provider: SavedProvider, anthropic: boolean): Record<string, string> {
  const key = provider.apiKey.trim();
  if (anthropic) {
    return {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    authorization: `Bearer ${key}`,
  };
}

/** Pull a readable message out of a provider error body. */
async function describeHttpError(res: Response, provider: SavedProvider): Promise<string> {
  let detail = '';
  try {
    const raw = await res.text();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          error?: { message?: string } | string;
          message?: string;
        };
        if (typeof parsed.error === 'string') detail = parsed.error;
        else detail = parsed.error?.message ?? parsed.message ?? '';
      } catch {
        detail = raw.slice(0, 200);
      }
    }
  } catch {
    // Body unreadable; the status code is still useful.
  }

  if (res.status === 401 || res.status === 403) {
    return `Provider rejected the API key (${res.status}). Check it in Settings.${detail ? ` ${detail}` : ''}`;
  }
  if (res.status === 404) {
    return `No chat endpoint at ${provider.baseUrl}. Check that the base URL is the API root.`;
  }
  if (res.status === 429) {
    return 'The provider is rate limiting this key. Wait a moment and retry.';
  }
  if (res.status >= 500) {
    return `Provider error ${res.status}. Try again shortly.${detail ? ` ${detail}` : ''}`;
  }
  return `Provider returned ${res.status}.${detail ? ` ${detail}` : ''}`;
}

type TokenSink = (token: string) => void;

/** Extract a delta from either OpenAI or Anthropic SSE JSON. */
function extractToken(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as {
    choices?: Array<{ delta?: { content?: string | null }; text?: string }>;
    delta?: { text?: string };
    type?: string;
  };
  const openAi = obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.text;
  if (typeof openAi === 'string') return openAi;
  if (obj.type === 'content_block_delta' && typeof obj.delta?.text === 'string') {
    return obj.delta.text;
  }
  return '';
}

/** Non-streaming fallback: pull the assistant text out of a JSON response. */
function extractMessageText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as {
    choices?: Array<{ message?: { content?: string | null } }>;
    content?: Array<{ type?: string; text?: string }>;
  };
  const openAi = obj.choices?.[0]?.message?.content;
  if (typeof openAi === 'string') return openAi;
  if (Array.isArray(obj.content)) {
    return obj.content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  return '';
}

/** True when an SSE payload is an error event. */
function extractError(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as {
    error?: { message?: string } | string;
    type?: string;
    message?: string;
  };
  if (obj.type === 'error') {
    if (typeof obj.error === 'string') return obj.error;
    return obj.error?.message ?? obj.message ?? 'Provider stream error.';
  }
  if (obj.error) {
    if (typeof obj.error === 'string') return obj.error;
    if (obj.error.message) return obj.error.message;
  }
  return null;
}

/** Consume one `data:` line. Returns true when the stream says it is done. */
function handleDataLine(data: string, sink: TokenSink): { done: boolean; error?: string } {
  const trimmed = data.trim();
  if (!trimmed) return { done: false };
  if (trimmed === '[DONE]') return { done: true };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const error = extractError(parsed);
    if (error) return { done: true, error };
    const token = extractToken(parsed);
    if (token) sink(token);
    return { done: false };
  } catch {
    // Keep-alive comments and provider-specific frames are not fatal.
    return { done: false };
  }
}

/**
 * Stream a chat completion from the primary provider.
 *
 * Aborting returns `ok: true` with whatever text arrived, so the caller can
 * persist the partial answer the user chose to stop.
 */
export async function streamChat(options: ChatStreamOptions): Promise<ChatStreamResult> {
  const provider = await getPrimaryProvider();
  if (!provider) {
    return { ok: false, error: 'No AI provider is connected. Add one in Settings.', aborted: false };
  }
  if (!provider.model.trim()) {
    return { ok: false, error: 'The provider has no model set. Add one in Settings.', aborted: false };
  }

  const { url, anthropic } = providerEndpoint(provider);
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    ...options.messages,
  ];

  let text = '';
  const sink: TokenSink = (token) => {
    text += token;
    options.onToken?.(token);
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(provider, anthropic),
      body: JSON.stringify(
        buildBody(provider, messages, anthropic, options.maxTokens ?? DEFAULT_MAX_TOKENS),
      ),
      signal: options.signal,
    });

    if (!res.ok) {
      const error = await describeHttpError(res, provider);
      return { ok: false, error, aborted: false };
    }

    // Some endpoints ignore `stream: true` and answer with a JSON body.
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const raw = await res.text();
      try {
        const text = extractMessageText(JSON.parse(raw) as unknown);
        if (text.trim()) return { ok: true, text, aborted: false };
        return { ok: false, error: 'The provider returned an empty response.', aborted: false };
      } catch {
        return { ok: false, error: 'The provider returned an unreadable response.', aborted: false };
      }
    }

    const body = res.body;
    if (!body) {
      // Some runtimes buffer the response. Parse it as SSE text rather than
      // failing outright, so the app still works on older fetch shims.
      const raw = await res.text();
      let sawData = false;
      for (const line of raw.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        sawData = true;
        const { done, error } = handleDataLine(line.slice(5), sink);
        if (error) return { ok: false, error, aborted: false };
        if (done) break;
      }
      if (!sawData) {
        try {
          const fallback = extractMessageText(JSON.parse(raw) as unknown);
          if (fallback.trim()) return { ok: true, text: fallback, aborted: false };
        } catch {
          // Not JSON either; report the empty response below.
        }
      }
      return { ok: true, text, aborted: false };
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) {
          const { done: streamDone, error } = handleDataLine(line.slice(5), sink);
          if (error) return { ok: false, error, aborted: false };
          if (streamDone) {
            await reader.cancel().catch(() => undefined);
            return { ok: true, text, aborted: false };
          }
        }
        newline = buffer.indexOf('\n');
      }
    }

    if (buffer.startsWith('data:')) {
      const { error } = handleDataLine(buffer.slice(5), sink);
      if (error) return { ok: false, error, aborted: false };
    }

    return { ok: true, text, aborted: false };
  } catch (err) {
    if (isAbort(err)) {
      return { ok: true, text, aborted: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reach ${provider.baseUrl} — ${message}`, aborted: false };
  }
}

function isAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || /aborted|abort/i.test(err.message);
}
