/**
 * Envelope encryption for BYOK credentials.
 *
 * AES-GCM via WebCrypto, keyed by SHA-256 of the ENCRYPTION_KEY env var. The
 * stored form is `v1.<iv>.<ciphertext>` with base64url parts, so the version is
 * visible and a future key rotation can be detected rather than silently
 * mis-decrypting.
 *
 * FAIL-CLOSED BY DESIGN: if ENCRYPTION_KEY is absent, every write and read of a
 * credential fails loudly. Silently storing a key in plaintext because a secret
 * was missing would be the worst possible outcome — the user would believe their
 * key is encrypted and it would not be.
 */

const VERSION = 'v1';
const IV_BYTES = 12;

export class CredentialCryptoError extends Error {
  constructor(
    message: string,
    readonly code: string = 'ENCRYPTION_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(secret);
  // SHA-256 so any passphrase length yields a full-strength AES-256 key.
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Fail fast when the Worker cannot encrypt anything.
 *
 * This exists because the failure is otherwise invisible: with no stored rows
 * the crypto path is never entered, so a Worker missing ENCRYPTION_KEY would
 * happily report its provider list as writable and then reject every save.
 * ENCRYPTION_KEY is infrastructure (like SESSION_SECRET), not a model key —
 * there is deliberately no way to derive it from a user credential.
 */
export function assertConfigured(envSecret: string | undefined): void {
  requireSecret(envSecret);
}

function requireSecret(envSecret: string | undefined): string {
  const secret = envSecret?.trim();
  if (!secret) {
    throw new CredentialCryptoError(
      'ENCRYPTION_KEY is not set, so credentials cannot be stored. Set it with: wrangler secret put ENCRYPTION_KEY',
    );
  }
  if (secret.length < 16) {
    throw new CredentialCryptoError(
      'ENCRYPTION_KEY is shorter than 16 characters, which is not safe for credential storage.',
      'ENCRYPTION_KEY_TOO_SHORT',
    );
  }
  return secret;
}

export async function seal(plaintext: string, envSecret: string | undefined): Promise<string> {
  const key = await importKey(requireSecret(envSecret));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION}.${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ciphertext))}`;
}

/**
 * Returns null for a ciphertext written by a different scheme version, so a
 * stored-but-unreadable credential degrades to "no key saved" rather than
 * crashing a run. A wrong ENCRYPTION_KEY surfaces as a throw — that is an
 * operator error and must be loud.
 */
export async function open(
  stored: string,
  envSecret: string | undefined,
): Promise<string | null> {
  const parts = stored.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, ivPart, bodyPart] = parts as [string, string, string];

  const key = await importKey(requireSecret(envSecret));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(ivPart) },
      key,
      b64urlDecode(bodyPart),
    );
  } catch {
    throw new CredentialCryptoError(
      'A stored credential could not be decrypted with the current ENCRYPTION_KEY. If the key was rotated, credentials must be re-entered.',
      'DECRYPT_FAILED',
    );
  }
  return new TextDecoder().decode(plaintext);
}

/** A short, non-reversible hint so Settings can show "key saved" honestly. */
export async function fingerprint(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`tmm-fp:${plaintext}`),
  );
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 4; i++) hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  return hex;
}
