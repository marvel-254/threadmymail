/**
 * Shared Hono types.
 *
 * `Bindings` and `Vars` were local to routes.ts. http/auth.ts needs the same
 * shapes, and duplicating them produced two structurally-identical-but-distinct
 * Context types that TypeScript correctly refused to treat as interchangeable.
 * One definition, imported by both.
 */

import type { DbEnv } from '../db/client.js';

export type Bindings = DbEnv & {
  /** Which environment this is. "production" is what turns auth ON. */
  ENVIRONMENT?: string;
  /** D1 blob store. Email bodies only — Postgres holds the key (invariant 4). */
  BODIES: D1Database;
  /** The agent DO. POST /agent/runs and abort delegate execution here. */
  AGENT: DurableObjectNamespace;
  /** Encrypts per-user BYOK credentials. Absent ⇒ credential writes fail loudly. */
  ENCRYPTION_KEY?: string;
  /** HMAC key for session cookies. Absent in production ⇒ every route 401s. */
  SESSION_SECRET?: string;
  /** Google OAuth. Absent ⇒ /auth/google returns 503 rather than a broken redirect. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  /** Comma-separated browser origins. Also the post-login redirect target. */
  CORS_ORIGINS?: string;
};

export type Vars = {
  Bindings: Bindings;
  /** Set once per request by the identity middleware. null ⇒ anonymous. */
  Variables: { uid: string | null };
};
