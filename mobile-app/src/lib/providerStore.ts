/**
 * ProviderStore — BYOK AI provider credentials.
 *
 * Same rule as AccountStore: keys live in the OS keychain (expo-secure-store),
 * never in SQLite or AsyncStorage, and never leave the device. Nothing is
 * proxied through a server — `testProvider` talks to the user's own endpoint.
 *
 * A "provider" is an OpenAI-compatible endpoint + key + default model. The
 * presets in `providers.ts` supply sensible defaults; a custom entry carries
 * whatever base URL the user typed.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { normalizeBaseUrl, reachableBaseUrl } from './providers';

const PROVIDERS_KEY = 'threadmymail.providers.v1';

export type SavedProvider = {
  /** Preset id, or 'custom'. */
  id: string;
  /** Display name. */
  label: string;
  /** OpenAI-compatible base URL, normalised (no trailing slash). */
  baseUrl: string;
  /** Model id used unless a skill overrides it. */
  model: string;
  /** The user's key. Never rendered — see `maskKey`. */
  apiKey: string;
  /** Exactly one provider is primary; the agent calls this one. */
  primary: boolean;
};

/** Load every saved provider. Returns [] when none. */
export async function loadProviders(): Promise<SavedProvider[]> {
  const raw = await SecureStore.getItemAsync(PROVIDERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop anything that is not shaped like a provider rather than handing a
    // half-written record to the caller.
    return parsed.filter(
      (p): p is SavedProvider =>
        !!p && typeof p === 'object' && typeof (p as SavedProvider).baseUrl === 'string',
    );
  } catch {
    return [];
  }
}

async function writeProviders(list: SavedProvider[]): Promise<void> {
  await SecureStore.setItemAsync(PROVIDERS_KEY, JSON.stringify(list));
}

/**
 * Add a provider. The first provider added becomes primary automatically, so
 * the agent always has somewhere to call.
 */
export async function addProvider(input: Omit<SavedProvider, 'primary'>): Promise<SavedProvider[]> {
  const list = await loadProviders();
  const existing = list.find((p) => p.id === input.id);
  // Re-adding the same preset replaces the old entry rather than duplicating it.
  const next = list.filter((p) => p.id !== input.id);
  const saved: SavedProvider = {
    ...input,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    // Keep primary if we are updating the current primary; otherwise first one wins.
    primary: existing?.primary === true || next.length === 0,
  };
  if (saved.primary) {
    for (const p of next) p.primary = false;
  }
  next.push(saved);
  await writeProviders(next);
  return next;
}

/** Remove a provider by id. If the primary is removed, promote the first. */
export async function removeProvider(id: string): Promise<SavedProvider[]> {
  let list = (await loadProviders()).filter((p) => p.id !== id);
  if (list.length > 0 && !list.some((p) => p.primary)) {
    list = list.map((p, i) => ({ ...p, primary: i === 0 }));
  }
  await writeProviders(list);
  return list;
}

/** Make one provider primary and demote the rest. */
export async function setPrimary(id: string): Promise<SavedProvider[]> {
  const list = await loadProviders();
  const next = list.map((p) => ({ ...p, primary: p.id === id }));
  await writeProviders(next);
  return next;
}

/** The provider the agent calls, or null when none is configured. */
export async function getPrimaryProvider(): Promise<SavedProvider | null> {
  const list = await loadProviders();
  return list.find((p) => p.primary) ?? list[0] ?? null;
}

/** Remove every provider. */
export async function clearProviders(): Promise<void> {
  await SecureStore.deleteItemAsync(PROVIDERS_KEY);
}

/**
 * A fingerprint of the key, never the key.
 *
 * The landing page promises "Settings shows a fingerprint, never the key".
 * Showing the last four characters is the most that can be useful for telling
 * two keys apart; anything more is a secret the UI has no business showing.
 */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length === 0) return 'no key';
  if (k.length <= 8) return '••••••••';
  return `••••••••${k.slice(-4)}`;
}

export type ProviderTestResult =
  | { ok: true; detail: string }
  | { ok: false; detail: string };

/**
 * Verify a provider by calling its `GET /models`.
 *
 * Deliberately not `/chat/completions`: listing models is free, needs no
 * prompt, and fails for exactly the reasons we care about — wrong key, wrong
 * base URL, unreachable host. A chat call would also burn the user's tokens to
 * answer a question a model list answers.
 */
export async function testProvider(input: {
  baseUrl: string;
  apiKey: string;
  model?: string;
  id?: string;
}): Promise<ProviderTestResult> {
  const baseUrl = reachableBaseUrl(input.baseUrl, Platform.OS);
  if (!baseUrl) return { ok: false, detail: 'No base URL — set one first.' };

  const anthropic = input.id === 'anthropic' || baseUrl.includes('api.anthropic.com');
  const openrouter = input.id === 'openrouter' || baseUrl.includes('openrouter.ai');
  const local = input.id === 'local' || /127\.0\.0\.1|10\.0\.2\.2|localhost/i.test(baseUrl);
  const key = input.apiKey.trim();
  if (!key && !local) {
    return { ok: false, detail: 'Paste your API key first.' };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (anthropic) {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else if (key) {
    headers.Authorization = `Bearer ${key}`;
  }
  if (openrouter) {
    headers['HTTP-Referer'] = 'https://threadmymail.omixsystems.store';
    headers['X-Title'] = 'ThreadMyMail';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (res.ok) {
      let count: number | undefined;
      try {
        const body = (await res.json()) as { data?: unknown[] };
        if (Array.isArray(body.data)) count = body.data.length;
      } catch {
        // A 200 with an unparseable body still proves the endpoint is alive
        // and the key was accepted.
      }
      return {
        ok: true,
        detail: count !== undefined ? `Connected · ${count} models available` : 'Connected',
      };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: 'Key rejected — check the API key and that it is active.' };
    }
    if (res.status === 404) {
      return { ok: false, detail: 'No /models endpoint here — check the base URL is the API root.' };
    }
    if (res.status === 429) {
      return { ok: true, detail: 'Connected, but rate limited. Key looks valid.' };
    }
    return { ok: false, detail: `Endpoint returned ${res.status}.` };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, detail: 'Timed out after 12s — endpoint unreachable or blocked.' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `Could not reach ${baseUrl} — ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
