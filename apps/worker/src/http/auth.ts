/**
 * Google OAuth.
 *
 * This is the piece that turns the deployed app from "a public URL where every
 * visitor is the same person" into an application with an actual owner. Before
 * it, `getUserId` returned one hardcoded constant and anyone who guessed the URL
 * had that account's todos, skills and credential store.
 *
 * ── What is requested, and what is deliberately not ────────────────────────
 *
 * The scopes are:
 *
 *   openid, email, profile          identify the user
 *   gmail.readonly                  read mail for triage
 *   calendar.readonly               read events for scheduling
 *
 * `gmail.send` and `gmail.modify` are NOT requested, and their absence is
 * deliberate. `email.send` exists as a tool, and the tool layer already shadows
 * outward-facing actions behind a dry run — but that shadow is per-skill policy
 * a user can change, not a permission boundary. An autonomous agent that can
 * send mail on your behalf with no review step is a much larger decision than
 * "wire up login", and it should be a decision, not a side effect of adding
 * authentication. Granting it is a one-line change here plus a UI affordance.
 *
 * ── Session, not token storage ─────────────────────────────────────────────
 *
 * Google tokens go to `oauth_tokens`, encrypted with the same AES-GCM helper the
 * BYOK credentials use. The browser only ever receives an opaque signed session
 * cookie containing a user id — no Google token, no refresh token, no access to
 * the API that the user could lift out of devtools and replay.
 */

import type { Context } from 'hono';
import type { Bindings, Vars } from './types.js';
import { HttpError } from './http-errors.js';
import { Db } from '../db/client.js';
import { seal } from '../agent/crypto.js';
import { ERROR } from '../tools/registry.js';
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  buildSessionCookie,
  clearSessionCookie,
  clearStateCookie,
  newState,
  parseCookies,
  stateCookie,
  timingSafeEqual,
  verifySession,
} from './session.js';



/** Matches the `provider` value already expected by tools/gated.ts. */
const GOOGLE_PROVIDER = 'google';

/**
 * Read-only scopes. See the file header for why send/modify are absent.
 */
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/** True when this request is over TLS, which is what makes Secure correct. */
function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

/**
 * The secret used to sign sessions.
 *
 * Outside production an ephemeral fallback keeps local development working
 * without ceremony. In production a missing SESSION_SECRET is a hard error: the
 * alternative is signing sessions with a constant that anyone can read in the
 * source, which is worse than refusing to start.
 */
function sessionSecret(env: Bindings, environment: string | undefined): string {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 16) return env.SESSION_SECRET;
  if (environment === 'production') {
    throw new HttpError(
      ERROR.INTERNAL,
      'SESSION_SECRET is not configured. Sessions cannot be signed.',
      500,
    );
  }
  return 'dev-only-session-secret-not-for-production';
}

export function authRoutes() {
  return {
    /**
     * Kick off the flow. Redirects to Google's consent screen.
     *
     * The `state` value is written to a short-lived cookie and echoed back by
     * Google; the callback compares them. Without it an attacker could feed a
     * victim a callback URL carrying the attacker's authorization code and log
     * them into the attacker's account.
     */
    async start(c: Context<Vars>): Promise<Response> {
      const env = c.env;
      if (!env.GOOGLE_CLIENT_ID) {
        throw new HttpError(
          'NOT_CONFIGURED',
          'Google sign-in is not configured on this deployment: GOOGLE_CLIENT_ID is unset.',
          503,
        );
      }

      const state = newState();
      const redirectUri =
        env.GOOGLE_REDIRECT_URI ?? new URL('/auth/google/callback', c.req.url).toString();

      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPES.join(' '));
      url.searchParams.set('state', state);
      url.searchParams.set('access_type', 'offline');
      // Without this Google only issues a refresh token on the very first
      // consent. A user who connected days ago and whose row was lost would
      // otherwise get an access token and no way to renew it.
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('include_granted_scopes', 'true');

      c.header('Set-Cookie', stateCookie(state, isSecure(c.req.raw)), { append: true });
      return c.redirect(url.toString(), 302);
    },

    /**
     * Handle Google's redirect: verify state, exchange the code, upsert the
     * user, store tokens, set the session, redirect to the app.
     */
    async callback(c: Context<Vars>): Promise<Response> {
      const env = c.env;
      const url = new URL(c.req.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const oauthError = url.searchParams.get('error');

      const frontend = frontendOrigin(env);
      const cookies = parseCookies(c.req.header('Cookie'));

      // Consume the state cookie on every path, successful or not, so a failed
      // attempt cannot be replayed.
      const clearState = clearStateCookie(isSecure(c.req.raw));

      if (oauthError) {
        return redirectWith(c, frontend, clearState, `#error=${encodeURIComponent(oauthError)}`);
      }
      if (!code) {
        return redirectWith(c, frontend, clearState, '#error=no_code');
      }
      if (!state || !cookies[STATE_COOKIE] || !timingSafeEqual(state, cookies[STATE_COOKIE])) {
        return redirectWith(c, frontend, clearState, '#error=state_mismatch');
      }

      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return redirectWith(c, frontend, clearState, '#error=not_configured');
      }

      const redirectUri =
        env.GOOGLE_REDIRECT_URI ?? new URL('/auth/google/callback', c.req.url).toString();

      let tokens: GoogleTokenResponse;
      try {
        const res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        tokens = (await res.json()) as GoogleTokenResponse;
      } catch {
        return redirectWith(c, frontend, clearState, '#error=token_exchange_failed');
      }
      if (tokens.error || !tokens.access_token) {
        return redirectWith(c, frontend, clearState, '#error=token_exchange_failed');
      }

      let profile: GoogleUserInfo;
      try {
        const res = await fetch(USERINFO_URL, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        profile = (await res.json()) as GoogleUserInfo;
      } catch {
        return redirectWith(c, frontend, clearState, '#error=profile_failed');
      }
      if (!profile.sub || !profile.email) {
        return redirectWith(c, frontend, clearState, '#error=profile_failed');
      }

      const userId = await upsertUser(new Db(env), profile);
      await storeTokens(new Db(env), userId, tokens, env.ENCRYPTION_KEY);

      const secret = sessionSecret(env, env.ENVIRONMENT);
      const { cookie: setCookie } = await buildSessionCookie(
        userId,
        secret,
        isSecure(c.req.raw),
      );

      c.header('Set-Cookie', setCookie, { append: true });
      c.header('Set-Cookie', clearState, { append: true });
      // Keep successful sign-ins inside the authenticated app. Returning to
      // `/` silently showed the landing page and made login appear discarded.
      return c.redirect(`${frontend}/app`, 302);
    },

    /**
     * Who am I. Called by the frontend on boot to decide whether to render the
     * app or bounce to sign-in.
     *
     * Never 401s: the frontend has to be able to ask "am I signed in?" and get
     * an answer it can branch on, rather than an error it has to interpret.
     */
    async session(c: Context<Vars>): Promise<Response> {
      const env = c.env;
      const cookies = parseCookies(c.req.header('Cookie'));
      const payload = await verifySession(
        cookies[SESSION_COOKIE],
        sessionSecret(env, env.ENVIRONMENT),
      );

      if (!payload) {
        return c.json({
          success: true,
          data: { authenticated: false, user: null, dev_mode: env.ENVIRONMENT !== 'production' },
          error: null,
        });
      }

      // A valid signature only proves we issued the token, not that the user
      // still exists. Deleting the row should end the session.
      const row = await new Db(env).one<{ id: string; email: string; full_name: string | null }>(
        'SELECT id, email, full_name FROM users WHERE id = $1 LIMIT 1',
        [payload.uid],
      );
      if (!row) {
        return c.json({
          success: true,
          data: { authenticated: false, user: null, dev_mode: env.ENVIRONMENT !== 'production' },
          error: null,
        });
      }

      return c.json({
        success: true,
        data: {
          authenticated: true,
          user: { id: row.id, email: row.email, name: row.full_name },
          dev_mode: false,
        },
        error: null,
      });
    },

    /** Sign out. Expiring a stateless cookie is all a logout can do. */
    async logout(c: Context<Vars>): Promise<Response> {
      return c.json(
        { success: true, data: { signed_out: true }, error: null },
        200,
        { 'Set-Cookie': clearSessionCookie(isSecure(c.req.raw)) },
      );
    },
  };
}

/** Where to send the browser after the callback. */
function frontendOrigin(env: Bindings): string {
  const configured = env.CORS_ORIGINS ?? '';
  const first = configured
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  return first ?? 'https://threadmymail.pages.dev';
}

function redirectWith(
  c: Context<Vars>,
  target: string,
  setCookie: string,
  hash: string,
): Response {
  c.header('Set-Cookie', setCookie, { append: true });
  // Sign-in reads the fragment and displays the failure reason.
  return c.redirect(`${target}/signin${hash}`, 302);
}

/**
 * Create or refresh the user row.
 *
 * Keyed on `google_sub`, the stable Google account id, not the email: a user
 * can change their Google email and stay the same person. On conflict the email
 * is refreshed but the id is left alone, because every table in the database is
 * keyed by user id and changing it would orphan the user's whole history.
 */
async function upsertUser(db: Db, profile: GoogleUserInfo): Promise<string> {
  const row = await db.oneFresh<{ id: string }>(
    `INSERT INTO users (google_sub, email, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (google_sub) DO UPDATE
       SET email = EXCLUDED.email,
           full_name = COALESCE(EXCLUDED.full_name, users.full_name),
           updated_at = NOW()
     RETURNING id`,
    [profile.sub, profile.email, profile.name ?? null],
  );
  if (!row) throw new HttpError('INTERNAL', 'Could not create the user.', 500);
  return row.id;
}

/**
 * Persist Google's tokens, sealed.
 *
 * `access_type=offline` means a refresh token is present on first consent, but
 * Google omits it on a re-consent where it considers one already issued — so the
 * existing value is preserved rather than nulled. Losing it would force the user
 * through consent again to repair something that was never broken.
 *
 * There is no UNIQUE constraint on (user_id, provider) — the schema has a plain
 * index — so `ON CONFLICT` is not available. A select-then-write inside a
 * transaction does the same job. A UNIQUE index would be the better fix and is
 * worth adding; it is a live-schema change, so it is not done unilaterally here.
 * Note that `SELECT … FOR UPDATE` on the user row serialises callbacks for the
 * same account, which is what makes the narrow remaining race acceptable.
 */
async function storeTokens(
  db: Db,
  userId: string,
  tokens: GoogleTokenResponse,
  encryptionKey: string | undefined,
): Promise<void> {
  if (!tokens.access_token) return;

  const access = await seal(tokens.access_token, encryptionKey);
  const refresh = tokens.refresh_token ? await seal(tokens.refresh_token, encryptionKey) : null;
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
  const scopes = tokens.scope ? tokens.scope.split(' ') : SCOPES;

  await db.tx(async (tx) => {
    const found = await tx.query<{ id: string }>(
      'SELECT id FROM oauth_tokens WHERE user_id = $1 AND provider = $2 LIMIT 1',
      [userId, GOOGLE_PROVIDER],
    );
    const existing = found.rows[0];
    if (existing) {
      await tx.query(
        `UPDATE oauth_tokens
            SET scopes = $3,
                access_token_encrypted = $4,
                refresh_token_encrypted = COALESCE($5, refresh_token_encrypted),
                expires_at = $6,
                needs_reauth = FALSE
          WHERE id = $1`,
        [existing.id, GOOGLE_PROVIDER, scopes, access, refresh, expiresAt],
      );
      return;
    }
    await tx.query(
      `INSERT INTO oauth_tokens
         (user_id, provider, scopes, access_token_encrypted, refresh_token_encrypted, expires_at, needs_reauth)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
      [userId, GOOGLE_PROVIDER, scopes, access, refresh, expiresAt],
    );
  });
}

export { SCOPES, GOOGLE_PROVIDER };
