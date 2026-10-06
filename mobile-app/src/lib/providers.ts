/**
 * AI provider catalog — single source of truth.
 *
 * Both onboarding (first run) and Settings (add provider) must agree on which
 * providers exist and what their OpenAI-compatible base URL is, so the presets
 * live here rather than being duplicated per screen.
 *
 * `baseUrl` is the OpenAI-compatible endpoint. Custom providers have no
 * preset, which is why the UI expands a base URL field for them.
 */

export type ProviderPreset = {
  /** Stable key used as the provider id when the user saves it. */
  id: string;
  /** Display name in the picker. */
  label: string;
  /** OpenAI-compatible base URL. Empty string means "custom". */
  baseUrl: string;
  /** Sensible default model id; the user can override it. */
  defaultModel: string;
  /** Prefix of the API key, used to hint the expected key format. */
  keyHint: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    keyHint: 'sk-or-…',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    keyHint: 'sk-…',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    keyHint: 'sk-ant-…',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    keyHint: 'AIza…',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyHint: 'sk-…',
  },
  {
    id: 'local',
    label: 'Local / self-hosted',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.1',
    keyHint: 'optional',
  },
  {
    id: 'custom',
    label: 'Custom',
    baseUrl: '',
    defaultModel: '',
    keyHint: 'your key',
  },
];

export const CUSTOM_PROVIDER_ID = 'custom';

/** Look up a preset by its id. */
export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * Normalise a user-entered base URL: trim, and drop a trailing slash so we
 * never concatenate a double slash onto `/chat/completions` later.
 */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}