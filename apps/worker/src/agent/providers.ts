/**
 * Model provider registry.
 *
 * BYOK, per user, encrypted at rest. This module is the single place that knows
 * how to turn a provider id into a request target. Everything else — the model
 * client, the settings API, the frontend picker — reads from here, so a new
 * provider is one row, not a branch in three files.
 *
 * WHY TWO DIALECTS AND NOT TWELVE:
 *   Nearly every provider on this list now speaks the OpenAI Chat Completions
 *   shape (OpenRouter, OpenAI, Groq, Mistral, xAI, Together, Fireworks,
 *   Perplexity, DeepSeek, Cerebras, and even Google's OpenAI-compat endpoint).
 *   Anthropic is the significant holdout and uses its own Messages API. So the
 *   client implements exactly two wire formats and the table below says which.
 *   A genuinely bespoke third format should be added here deliberately, not
 *   grown by accident.
 */

export type ProviderDialect = 'openai' | 'anthropic';

export interface ProviderSpec {
  id: string;
  label: string;
  dialect: ProviderDialect;
  /** Base URL WITHOUT a trailing slash. */
  baseUrl: string;
  /** Shown in Settings as a hint for the key format. */
  keyHint: string;
  /** Default model suggestion for the primary slot. Empty = no opinion. */
  suggestPrimary: string;
  /** Default model suggestion for the cheap background slot. */
  suggestBackground: string;
  /** Where to send the user to obtain a key. */
  keyUrl: string;
  /** Local/self-hosted providers allow http on loopback. */
  local?: boolean;
  /** Set on the one user-defined entry. */
  custom?: boolean;
}

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    dialect: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyHint: 'sk-or-v1-…',
    suggestPrimary: 'anthropic/claude-sonnet-4',
    suggestBackground: 'google/gemini-flash-1.5',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    dialect: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    keyHint: 'sk-ant-…',
    suggestPrimary: 'claude-sonnet-4-20250514',
    suggestBackground: 'claude-haiku-4-5-20251001',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    dialect: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    keyHint: 'sk-…',
    suggestPrimary: 'gpt-4.1',
    suggestBackground: 'gpt-4.1-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    dialect: 'openai',
    // Google's OpenAI-compatibility layer. Chosen deliberately over the native
    // generateContent API: it keeps the client to two dialects instead of three,
    // and it is the surface Google documents for OpenAI SDK users.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyHint: 'AIza…',
    suggestPrimary: 'gemini-2.5-pro',
    suggestBackground: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    dialect: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    keyHint: 'sk-…',
    suggestPrimary: 'deepseek-chat',
    suggestBackground: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'groq',
    label: 'Groq',
    dialect: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyHint: 'gsk_…',
    suggestPrimary: 'llama-3.3-70b-versatile',
    suggestBackground: 'llama-3.1-8b-instant',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    dialect: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    keyHint: '',
    suggestPrimary: 'mistral-large-latest',
    suggestBackground: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    dialect: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    keyHint: 'xai-…',
    suggestPrimary: 'grok-4',
    suggestBackground: 'grok-3-mini',
    keyUrl: 'https://console.x.ai/',
  },
  {
    id: 'together',
    label: 'Together AI',
    dialect: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    keyHint: '',
    suggestPrimary: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    suggestBackground: 'meta-llama/Llama-3.1-8B-Instruct-Turbo',
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    dialect: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    keyHint: '',
    suggestPrimary: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    suggestBackground: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
    keyUrl: 'https://fireworks.ai/api-keys',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    dialect: 'openai',
    baseUrl: 'https://api.perplexity.ai',
    keyHint: 'pplx-…',
    suggestPrimary: 'sonar-pro',
    suggestBackground: 'sonar',
    keyUrl: 'https://www.perplexity.ai/settings/api',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    dialect: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    keyHint: 'csk-…',
    suggestPrimary: 'llama-3.3-70b',
    suggestBackground: 'llama3.1-8b',
    keyUrl: 'https://cloud.cerebras.ai/',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    dialect: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyHint: 'optional',
    suggestPrimary: 'llama3.2',
    suggestBackground: 'qwen2.5:3b',
    keyUrl: 'https://ollama.com/',
    local: true,
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    dialect: 'openai',
    baseUrl: '',
    keyHint: '',
    suggestPrimary: '',
    suggestBackground: '',
    keyUrl: '',
    custom: true,
  },
] as const;

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function providerSpec(id: string): ProviderSpec | null {
  return BY_ID.get(id) ?? null;
}
export function providerIds(): string[] {
  return PROVIDERS.map((p) => p.id);
}

/** The public shape the Settings UI renders from. Never includes secrets. */
export interface ProviderCatalogueEntry {
  id: string;
  label: string;
  key_hint: string;
  key_url: string;
  suggest_primary: string;
  suggest_background: string;
  /** True when the user must supply a base URL before this can be used. */
  requires_base_url: boolean;
  /** True when the provider may run over plain http (loopback only). */
  local: boolean;
  custom: boolean;
}

export function catalogue(): ProviderCatalogueEntry[] {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    key_hint: p.keyHint,
    key_url: p.keyUrl,
    suggest_primary: p.suggestPrimary,
    suggest_background: p.suggestBackground,
    requires_base_url: p.custom === true,
    local: p.local === true,
    custom: p.custom === true,
  }));
}

const MAX_BASE_URL_LEN = 300;

/**
 * Validate a user-supplied base URL.
 *
 * SSRF note: this value is fetched by the Worker on the user's behalf, so it is
 * a genuine fetch target and not merely a string. The rule is therefore strict —
 * https anywhere, with plain http permitted ONLY on loopback, and only for
 * providers flagged `local`. That covers Ollama/LM Studio on the same machine
 * without letting a "custom endpoint" become a request proxy into an internal
 * network. Credentials are never attached to a non-loopback http target.
 */
export function validateBaseUrl(
  raw: string,
  providerId: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  if (value === '') return { ok: false, message: 'base_url is required for a custom provider.' };
  if (value.length > MAX_BASE_URL_LEN) return { ok: false, message: 'base_url is too long.' };
  if (/[\s]/.test(value)) return { ok: false, message: 'base_url must not contain spaces.' };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: 'base_url must be a valid absolute URL.' };
  }

  if (url.search !== '' || url.hash !== '') {
    return { ok: false, message: 'base_url must not carry a query string or fragment.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, message: 'base_url must not embed credentials.' };
  }

  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]';

  if (url.protocol === 'https:') {
    return { ok: true, value: url.toString().replace(/\/+$/, '') };
  }
  if (url.protocol === 'http:' && loopback) {
    if (!BY_ID.get(providerId)?.local) {
      // Name the fix, not just the rule: the user almost always means "my
      // local model server" and the right provider for that is `ollama`.
      return {
        ok: false,
        message:
          'Plain http is only allowed on loopback, and only for a local model provider. ' +
          'Use the Ollama provider for a local server, or give an https URL.',
      };
    }
    return { ok: true, value: url.toString().replace(/\/+$/, '') };
  }
  return {
    ok: false,
    message: 'base_url must be https, or http on localhost for a local model.',
  };
}

/** Reject a key that is obviously not one, before we spend a request on it. */
export function validateApiKey(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  if (value === '') return { ok: false, message: 'api_key must not be empty.' };
  if (value.length < 8) return { ok: false, message: 'api_key looks too short to be valid.' };
  if (value.length > 400) return { ok: false, message: 'api_key is too long.' };
  if (/[\r\n]/.test(value)) return { ok: false, message: 'api_key must not contain newlines.' };
  return { ok: true, value };
}
