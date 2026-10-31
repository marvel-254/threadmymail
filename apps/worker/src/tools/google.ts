/** Live Google API access using the sealed tokens in `oauth_tokens`. */

import { open } from '../agent/crypto.js';
import { ERROR, fail, type ToolContext, type ToolError } from './registry.js';
import { GOOGLE_PROVIDER } from './gated.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface TokenRow {
  id: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  expires_at: Date | string | null;
  needs_reauth: boolean;
}

export async function googleAccessToken(
  ctx: ToolContext,
): Promise<{ ok: true; token: string } | { ok: false; error: ToolError }> {
  const row = await ctx.db.oneFresh<TokenRow>(
    `SELECT id, access_token_encrypted, refresh_token_encrypted, expires_at, needs_reauth
       FROM oauth_tokens
      WHERE user_id = $1 AND provider = $2
      LIMIT 1`,
    [ctx.userId, GOOGLE_PROVIDER],
  );
  if (!row || row.needs_reauth) {
    return {
      ok: false,
      error: fail(
        ERROR.NEEDS_CONNECTION,
        'Your Google account is not connected, or needs to be reconnected.',
      ),
    };
  }
  if (!row.access_token_encrypted) {
    return { ok: false, error: fail(ERROR.NEEDS_REAUTH, 'No Google access token is stored.') };
  }

  const secret = ctx.oauth?.encryptionKey;
  let access: string | null;
  try {
    access = await open(row.access_token_encrypted, secret);
  } catch {
    return {
      ok: false,
      error: fail(ERROR.INTERNAL, 'Could not decrypt the stored Google token.'),
    };
  }
  if (!access) {
    return { ok: false, error: fail(ERROR.NEEDS_REAUTH, 'The stored Google token is unreadable.') };
  }

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt - 60_000 > Date.now()) return { ok: true, token: access };

  if (!row.refresh_token_encrypted || !ctx.oauth?.googleClientId || !ctx.oauth.googleClientSecret) {
    return {
      ok: false,
      error: fail(ERROR.NEEDS_REAUTH, 'The Google access token has expired and cannot be refreshed.'),
    };
  }

  let refresh: string | null;
  try {
    refresh = await open(row.refresh_token_encrypted, secret);
  } catch {
    return { ok: false, error: fail(ERROR.NEEDS_REAUTH, 'The Google refresh token could not be decrypted.') };
  }
  if (!refresh) {
    return { ok: false, error: fail(ERROR.NEEDS_REAUTH, 'The Google refresh token is unreadable.') };
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: ctx.oauth.googleClientId,
      client_secret: ctx.oauth.googleClientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    await ctx.db.queryFresh(
      `UPDATE oauth_tokens SET needs_reauth = TRUE WHERE id = $1`,
      [row.id],
    );
    return {
      ok: false,
      error: fail(ERROR.NEEDS_REAUTH, 'Google refused to refresh the token. Reconnect the account.'),
    };
  }

  const { seal } = await import('../agent/crypto.js');
  const sealed = await seal(body.access_token, secret);
  const nextExpiry = new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString();
  await ctx.db.queryFresh(
    `UPDATE oauth_tokens SET access_token_encrypted = $2, expires_at = $3, needs_reauth = FALSE WHERE id = $1`,
    [row.id, sealed, nextExpiry],
  );
  return { ok: true, token: body.access_token };
}

export async function googleFetch(
  ctx: ToolContext,
  url: string,
  init: RequestInit = {},
): Promise<{ ok: true; json: unknown } | { ok: false; error: ToolError }> {
  const token = await googleAccessToken(ctx);
  if (!token.ok) return token;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token.token}`,
    },
  });
  const json = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: fail(
        res.status === 401 ? ERROR.NEEDS_REAUTH : ERROR.FORBIDDEN,
        'Google rejected this call. The connected account may be missing the required scope.',
      ),
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: fail(ERROR.INTERNAL, `Google API returned ${res.status}.`),
    };
  }
  return { ok: true, json };
}
