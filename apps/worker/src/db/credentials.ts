/**
 * Per-user model credentials.
 *
 * STORAGE: `plugin_credentials`, not a new table. That table is already
 * (plugin_id, user_id, key) -> value_encrypted with exactly the right shape, and
 * the model key IS a plugin credential in the docs' own words (ARCHITECTURE §12).
 * Reusing it means no migration against live Neon for zero loss of clarity. Model
 * entries live under the reserved `model:` plugin_id namespace, so they can
 * never collide with a real plugin and can be relocated later without ambiguity.
 *
 * READ PATH: decrypts on demand, per run. Secrets are never returned by the API
 * and never logged — `GET /settings/providers` reports booleans and a
 * non-reversible fingerprint only.
 */

import { Db } from './client.js';
import { open as cryptoOpen, seal, fingerprint } from '../agent/crypto.js';
import { providerSpec, type ProviderSpec } from '../agent/providers.js';

/** Reserved namespace: these rows are model credentials, not plugins. */
const NS = 'model:';

const KEY_API = 'api_key';
const KEY_BASE_URL = 'base_url';

export interface StoredCredential {
  apiKey: string | null;
  baseUrl: string | null;
}

/** What the API is allowed to show the user about their own credentials. */
export interface CredentialStatus {
  provider: string;
  has_key: boolean;
  base_url: string | null;
  /** First 8 hex chars of a salted hash — identifies a key, reveals nothing. */
  fingerprint: string | null;
}

function pluginId(provider: string): string {
  return `${NS}${provider}`;
}

export class CredentialStore {
  constructor(
    private db: Db,
    private encryptionKey: string | undefined,
  ) {}

  /**
   * Save (or replace) the key and/or base URL for one provider.
   *
   * At most two rows, so one upsert per field is clearer than a clever
   * multi-row statement and keeps every value parameterized. `undefined` means
   * "leave alone"; an explicit null base URL means "clear it".
   */
  async save(
    userId: string,
    provider: string,
    input: { apiKey?: string; baseUrl?: string | null },
  ): Promise<void> {
    const writes: Array<[string, string]> = [];
    if (input.apiKey !== undefined) writes.push([KEY_API, await seal(input.apiKey, this.encryptionKey)]);
    if (input.baseUrl !== undefined) {
      writes.push([KEY_BASE_URL, input.baseUrl === null ? '' : await seal(input.baseUrl, this.encryptionKey)]);
    }

    for (const [key, value] of writes) {
      await this.db.queryFresh(
        `INSERT INTO plugin_credentials (plugin_id, user_id, key, value_encrypted)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (plugin_id, user_id, key)
         DO UPDATE SET value_encrypted = EXCLUDED.value_encrypted`,
        [pluginId(provider), userId, key, value],
      );
    }
  }

  /** Remove a provider's credentials entirely. */
  async remove(userId: string, provider: string): Promise<boolean> {
    const rows = await this.db.queryFresh(
      `DELETE FROM plugin_credentials
       WHERE plugin_id = $1 AND user_id = $2 RETURNING key`,
      [pluginId(provider), userId],
    );
    return rows.length > 0;
  }

  /** Decrypt a provider's credential. Missing row = null, not an error. */
  async load(userId: string, provider: string): Promise<StoredCredential> {
    const rows = await this.db.queryFresh<{ key: string; value_encrypted: string }>(
      `SELECT key, value_encrypted FROM plugin_credentials
       WHERE plugin_id = $1 AND user_id = $2`,
      [pluginId(provider), userId],
    );
    if (rows.length === 0) return { apiKey: null, baseUrl: null };

    const out: StoredCredential = { apiKey: null, baseUrl: null };
    for (const row of rows) {
      const value = await cryptoOpen(row.value_encrypted, this.encryptionKey);
      if (value === null) continue;
      if (row.key === KEY_API) out.apiKey = value;
      else if (row.key === KEY_BASE_URL) out.baseUrl = value === '' ? null : value;
    }
    return out;
  }

  /**
   * Non-secret status for every known provider, for the Settings UI.
   *
   * Decryption is per-row: one value that cannot be read (a rotated key, a
   * dev-only row that reached production) must not blank the whole list, since
   * that would tell a user with three good keys and one stale row that they
   * have configured nothing. Bad rows are skipped and counted so the caller can
   * warn about exactly the one that needs re-entering.
   */
  async status(
    userId: string,
    ids: readonly string[],
  ): Promise<{ credentials: CredentialStatus[]; undecryptable: number }> {
    const rows =
      ids.length === 0
        ? []
        : await this.db.queryFresh<{
            plugin_id: string;
            key: string;
            value_encrypted: string;
          }>(
            `SELECT plugin_id, key, value_encrypted FROM plugin_credentials
             WHERE user_id = $1 AND plugin_id = ANY($2::text[])`,
            [userId, ids.map(pluginId)],
          );

    // Decrypted values stay in this short-lived map and are reduced to a
    // boolean plus a fingerprint before anything is returned.
    const slots = new Map<string, { api?: string; base?: string | null }>();
    for (const id of ids) slots.set(id, {});
    let undecryptable = 0;

    for (const row of rows) {
      const provider = row.plugin_id.slice(NS.length);
      const slot = slots.get(provider);
      if (!slot) continue;
      // Decryption is per-row. If one value was sealed under a different
      // ENCRYPTION_KEY (a rotated key, a stale dev row that leaked into prod),
      // it must not zero out the whole list — that would tell the user they
      // have no keys configured when most of them decrypt fine. Skip the bad
      // one; it reads as "not set" and can be re-entered.
      let value: string | null;
      try {
        value = await cryptoOpen(row.value_encrypted, this.encryptionKey);
      } catch (err) {
        console.error(`credential status: cannot decrypt ${provider}.${row.key}:`, err);
        undecryptable++;
        continue;
      }
      if (value === null) continue;
      if (row.key === KEY_API) slot.api = value;
      else if (row.key === KEY_BASE_URL) slot.base = value === '' ? null : value;
    }

    const out: CredentialStatus[] = [];
    for (const id of ids) {
      const slot = slots.get(id) ?? {};
      out.push({
        provider: id,
        has_key: typeof slot.api === 'string' && slot.api !== '',
        base_url: slot.base ?? null,
        fingerprint: slot.api ? await fingerprint(slot.api) : null,
      });
    }
    return { credentials: out, undecryptable };
  }
}

/**
 * Resolve the concrete base URL for one provider.
 *
 * Precedence, and it is deliberate:
 *   1. a user-supplied base_url (credential-level, i.e. what Settings saved)
 *   2. the slot-level override from ai_config
 *   3. the provider's registered base URL
 *
 * SECURITY: a slot-level override is honoured ONLY for `custom` and `local`
 * providers. Without that restriction, saving `baseUrl` in ai_config would let
 * someone repoint a well-known provider at an internal address — the credential
 * path is validated, but ai_config is not a credential and must not be allowed
 * to redirect a request that carries a key. Anything else falls back to the
 * registered URL, so a stale or hostile value can never leave the process.
 *
 * A key is optional for loopback providers (local models usually need none) and
 * required everywhere else. Returns null — not a throw — when nothing is
 * resolvable, so callers can decide whether that is a user-facing error or a
 * reason to fall through to a more specific one.
 */
export function resolveBaseUrl(
  spec: ProviderSpec,
  credential: StoredCredential | null,
  slotBaseUrl: string | null,
): string | null {
  const overridable = spec.custom === true || spec.local === true;
  const override = overridable ? (credential?.baseUrl ?? slotBaseUrl) : null;
  const candidate = override ?? spec.baseUrl;
  if (candidate === '' || candidate === undefined) return null;
  return candidate;
}
