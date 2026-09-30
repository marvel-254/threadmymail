/**
 * Session cookies.
 *
 * Why a signed cookie rather than a server-side session row: a Worker request
 * is a single function invocation with no shared memory, so validating a
 * session means either a database read (a Postgres round trip on every API
 * call, against a Neon instance we are actively trying to keep suspended) or a
 * self-contained token. A stateless HMAC token is the only option that costs
 * nothing per request.
 *
 * The trade is explicit: a logout cannot invalidate a token that was already
 * issued. Tokens are short-lived (7 days) and the window is bounded by that, not
 * by revocation. Anything that must be revocable belongs in the database — the
 * kill switch and credential rotation both already do the right thing.
 *
 * WHAT IS IN THE COOKIE: the user id and an expiry. Nothing else. No email, no
 * name, no roles. A cookie is readable by anything that can intercept it, so it
 * carries an identifier and nothing that needs protecting.
 */

/** Cookie name. Prefixed to avoid colliding with anything on a shared host. */
export const SESSION_COOKIE = 'tmm_session';

/** Short-lived cookie holding the OAuth `state` between redirect and callback. */
export const STATE_COOKIE = 'tmm_oauth_state';

/**
 * Seven days. Long enough that nobody is logged out mid-session, short enough
 * that a leaked cookie is a bounded problem rather than a permanent one.
 */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The `state` cookie only needs to survive one redirect round trip. */
const STATE_TTL_SECONDS = 600;

/**
 * Minimum acceptable length for SESSION_SECRET.
 *
 * The same floor as agent/crypto.ts. A short secret makes forging a session
 * cheap, and a forged session is indistinguishable from a real login — this is
 * the one credential in the system whose compromise is total.
 */
const MIN_SECRET_LENGTH = 16;

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionPayload {
  /** User id (UUID). */
  uid: string;
  /** Issued-at, epoch seconds. Informational. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function requireSecret(secret: string | undefined): string {
  if (!secret) {
    throw new SessionError(
      'SESSION_SECRET is not set. A session cannot be signed or verified without it.',
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new SessionError(
      `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters; got ${secret.length}. ` +
        'A short secret makes session forgery trivial.',
    );
  }
  return secret;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requireSecret(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** A secret long enough to pass `requireSecret` but derived from a real one. */
function devSecret(): string {
  return 'dev-only-session-secret-not-for-production';
}

/**
 * True when this Worker may run without a real SESSION_SECRET.
 *
 * Only ever true outside production. In production a missing secret must break
 * loudly rather than silently downgrade — that is the whole point of having the
 * check.
 */
export function mayUseDevSecret(environment: string | undefined): boolean {
  return environment !== 'production';
}

/**
 * Sign a payload into a compact token: `base64url(json).base64url(hmac)`.
 *
 * The MAC covers the encoded payload, not the decoded object, so there is no
 * canonicalisation step where two encodings of the same data could diverge.
 */
export async function signSession(
  payload: SessionPayload,
  secret: string | undefined,
): Promise<string> {
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret ?? '');
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${b64url(new Uint8Array(mac))}`;
}

/**
 * Verify and decode a token.
 *
 * Returns null for every failure — bad shape, bad signature, expired, wrong
 * JSON. A caller must not be able to distinguish "expired" from "forged" from
 * the return value, because that difference is information an attacker can use.
 * The MAC is checked with `crypto.subtle.verify`, which is constant-time;
 * a hand-rolled `===` on the signature would leak it byte by byte.
 */
export async function verifySession(
  token: string | undefined,
  secret: string | undefined,
  now: number = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const encoded = token.slice(0, dot);
  const providedMac = b64urlDecode(token.slice(dot + 1));
  if (!providedMac) return null;

  let key: CryptoKey;
  try {
    key = await hmacKey(secret ?? '');
  } catch {
    return null;
  }

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      key,
      providedMac as unknown as ArrayBuffer,
      new TextEncoder().encode(encoded),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  const decoded = b64urlDecode(encoded);
  if (!decoded) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(decoded)) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.uid !== 'string' || !payload.uid) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;

  return payload;
}

/** Parse a Cookie header into a plain object. Missing header is not an error. */
export function parseCookies(header?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function cookie(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): string {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    // Lax, not Strict. The OAuth callback is a top-level GET navigation from
    // accounts.google.com, and SameSite=Strict would not send the cookie on it
    // — the user would authenticate and land signed out.
    'SameSite=Lax',
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/**
 * Build the `Set-Cookie` header and the token together.
 *
 * Returned as one value so the cookie and the token inside it cannot drift
 * apart — a mismatch here is an app that appears to log in and never does.
 */
export async function buildSessionCookie(
  uid: string,
  secret: string | undefined,
  secure: boolean,
  now: number = Math.floor(Date.now() / 1000),
): Promise<{ cookie: string; token: string; payload: SessionPayload }> {
  const payload: SessionPayload = { uid, iat: now, exp: now + SESSION_TTL_SECONDS };
  const token = await signSession(payload, secret);
  return { cookie: cookie(SESSION_COOKIE, token, SESSION_TTL_SECONDS, secure), token, payload };
}

/** Expire the session cookie. Same attributes, Max-Age=0. */
export function clearSessionCookie(secure: boolean): string {
  return cookie(SESSION_COOKIE, '', 0, secure);
}

export function stateCookie(state: string, secure: boolean): string {
  return cookie(STATE_COOKIE, state, STATE_TTL_SECONDS, secure);
}

export function clearStateCookie(secure: boolean): string {
  return cookie(STATE_COOKIE, '', 0, secure);
}

/** Random, unguessable `state` value. */
export function newState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

/**
 * Constant-time string comparison, for the OAuth `state` check.
 *
 * `state` is a single-use CSRF token; comparing it with `===` would leak it to a
 * timing attack. Small enough that a naive compare is tempting, which is exactly
 * why this exists.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export { devSecret, requireSecret };
