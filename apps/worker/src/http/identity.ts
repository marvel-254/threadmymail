/**
 * Who is making this request?
 *
 * Split out from routes.ts as a pure function — no Context, no database, no
 * bindings — because this is the security boundary of the whole application and
 * it needs to be testable without standing up Neon. A policy that can only be
 * exercised through a live database is a policy that does not get tested.
 *
 * The bug this exists to prevent: ThreadMyMail was deployed at a public URL where
 * every request resolved to one hardcoded user. `X-User-Id` was honoured from
 * anywhere, so anyone who guessed the dev user's UUID — which is printed in
 * routes.ts — was that user.
 */

import { verifySession } from './session.js';

export const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BadUserHeader extends Error {
  constructor() {
    super('X-User-Id must be a UUID.');
    this.name = 'BadUserHeader';
  }
}

export interface IdentityInput {
  /**
   * Raw Cookie header. Kept for callers that want to log or debug the request;
   * the decision itself reads `cookies`.
   */
  cookie?: string | null;
  /** Session signing key. Absent means no session can exist. */
  sessionSecret?: string;
  /** "production" turns on authentication. Anything else is development. */
  environment?: string;
  /** The X-User-Id header, if present. */
  userHeader?: string;
  /** Cookie values, already parsed, so the caller does not parse them twice. */
  cookies: Record<string, string>;
  /** Injectable for tests; defaults to the wall clock. */
  now?: number;
}

/**
 * Resolve a caller to a user id, or null when anonymous.
 *
 * Order, and each step matters:
 *
 *   1. A valid signed session cookie. This is the only path that is allowed to
 *      work in production.
 *   2. Outside production, `X-User-Id` — so tests and local tooling can act as a
 *      specific user.
 *   3. Outside production, the dev user — so the app is usable with no login.
 *   4. Otherwise null, which the caller turns into a 401.
 *
 * `X-User-Id` is ignored in production. Honouring it there would make the
 * session cookie decorative and re-open the exact hole this closes.
 */
export async function resolveIdentity(input: IdentityInput): Promise<string | null> {
  if (input.sessionSecret) {
    const token = input.cookies['tmm_session'];
    const payload = await verifySession(token, input.sessionSecret, input.now);
    if (payload) return payload.uid;
  }

  if (input.environment === 'production') return null;

  const header = input.userHeader;
  if (!header) return DEV_USER_ID;
  if (!UUID_RE.test(header)) throw new BadUserHeader();
  return header;
}
