# Google OAuth — ThreadMyMail

> Single consent grants **identity + Gmail + Calendar**.
> **Status:** Authoritative. **Last updated:** 2026-09-27

---

## 1. Decision

**One Google sign-in, one consent screen, all scopes, and it *is* the
application login.**

There is no separate signup flow, no magic link, and no password. Clicking
"Sign in with Google" authenticates the user *and* connects their mail and
calendar in a single interaction.

This is appropriate because the app is **single-user and personal**. The usual
argument for narrow scopes — third-party trust, public signups, consent
surfacing — does not apply to your own assistant reading your own mail.

### 1.1 Accepted trade-offs

| Consequence | Why acceptable | Mitigation |
|---|---|---|
| Google shows a **"Google hasn't verified this app"** warning screen | Expected for any app using sensitive scopes without Google's verification | Acceptable for a personal install; would block public signups |
| Scopes are **restricted**, requiring verification for distribution | Not distributing | — |
| Broad access if the app is ever compromised | Single-user, BYOK, self-hosted | Encryption at rest, no public write endpoints, full audit log |
| Scope additions can invalidate refresh tokens | Managed | See §5 — scopes live in a manifest, added in phases |

**Do not add Drive, Docs, or broad `cloud-platform` scopes.** If a later feature
needs Drive, add it as a **separate consent step** rather than widening the
initial grant. Scope creep in a single consent is how a personal tool becomes a
liability.

---

## 2. Requested Scopes

### 2.1 Phase 1 — initial consent

| Scope | Purpose |
|---|---|
| `openid` | Identity (id token) |
| `email` | Identity |
| `profile` | Display name |
| `https://www.googleapis.com/auth/gmail.readonly` | Future read-only mail features |
| `https://www.googleapis.com/auth/calendar.readonly` | Future read-only calendar features |

### 2.2 Phase 2 — only if a feature demands it

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/gmail.modify` + attachment scope | Attachment handling (currently metadata-only) |
| Drive scopes | **Prefer a separate consent step. Do not add to the initial grant.** |

### 2.3 Offline access

Include `access_type=offline` and `prompt=consent` on the **first** exchange so a
refresh token is issued. On subsequent reconnects, omit `prompt=consent` — forcing
consent every time is annoying and unnecessary.

---

## 3. Flow

```
Browser                Worker                   Google
   │                     │                        │
   │ GET /v1/auth/google │                        │
   │────────────────────►│                        │
   │◄──── 302 ───────────│                        │
   │                     │                        │
   │◄───────────────────────────────────────────────┤ consent screen
   │   (user reviews granular per-scope descriptions) │
   │                     │                        │
   │ GET /v1/auth/google/callback?code=… │         │
   │────────────────────►│──────────exchange──────►│
   │                     │◄────────tokens──────────│
   │◄──── 302 (session) ─│                        │
```

### 3.1 Endpoints

| Route | Role |
|---|---|
| `GET /auth/google` | Build the consent URL, 302 redirect |
| `GET /auth/google/callback` | Exchange code, upsert user, store tokens, set session, 302 to app |
| `POST /auth/logout` | Clear session |
| `GET /auth/me` | Current user + connection state |
| `GET /auth/status` | Token health, expiry, `needs_reauth` flag |

### 3.2 Callback URL

```
https://threadmymail.omixsystems.store/v1/auth/google/callback
```

The frontend's Pages Function proxies `/v1/*` to the API Worker. This keeps the
OAuth state and session cookies on the app's own hostname. Register this URI
exactly, with no trailing slash.

For the Web application OAuth client, the authorized JavaScript origin is
`https://threadmymail.omixsystems.store` (no path or trailing slash). The
branding authorized domain is `omixsystems.store`.

---

## 4. Token Storage

Generic, provider-keyed, scope-aware:

```sql
oauth_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,          -- 'google'
  scopes        TEXT[] NOT NULL,        -- so additions are detectable
  access_token_encrypted  TEXT,
  refresh_token_encrypted TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
)
```

- `access_token_encrypted` / `refresh_token_encrypted` use
  `ENCRYPTION_KEY` (AES-GCM via WebCrypto). **Never** returned by any endpoint,
  never logged.
- `scopes` is stored so the app can detect when a token lacks a newly-added scope
  and trigger a targeted re-consent instead of failing opaquely.
- **Gmail and Calendar share one token row.** One connection, two capability
  sets — there is no separate calendar connection.

### 4.1 Refresh

- Refresh proactively when `expires_at` is within 5 minutes
- On `invalid_grant`: set `needs_reauth`, surface a notification, and **stop
  retrying** — an infinite refresh loop against a revoked token is how you end up
  rate-limited and locked out
- Serialize refresh writes so a heartbeat and a chat turn cannot race two
  refreshes and invalidate each other
- A refresh token is invalidated by: password change, 6 months of inactivity,
  >100 accounts, or user revocation. Handle all four identically.

---

## 5. Scope Evolution

**Add scopes in phases; never widen the initial grant retroactively.**

1. Ship Phase 1 scopes
2. A feature needs more → add to the manifest as Phase 2
3. On next token use, detect the scope is missing → prompt for incremental
   re-consent with `include_granted_scopes=true`
4. **Do not** discard an existing refresh token during re-consent

Google generally allows incremental scope grants without a full re-consent, but
**changing the set of granted scopes can invalidate an existing refresh token.**
Persist the old token row and keep it until the new one is confirmed working, so
a failed re-consent is recoverable rather than requiring the user to re-connect
everything.

---

## 6. Setup Checklist

1. Google Cloud Console → **APIs & Services** → **OAuth consent screen**
2. External, single user. Add the app name, support email, developer email
3. Add the **exact** callback URL from §3.2
4. **Credentials** → **OAuth client ID** → *Web application*
5. Client ID + secret → set as Worker secrets:

   ```bash
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   ```

6. `GOOGLE_REDIRECT_URI` as a plain var
7. On first run, publish the consent screen (it can be tested while in
   "Testing" mode with your account added as a test user)

---

## 7. Verification

The app is "unverified", so expect this interstitial before the consent screen:

> **Google hasn't verified this app** — "This app hasn't been verified by Google,
> but it may be able to safely access your data."

That is expected and correct. It appears because the app uses sensitive scopes
without Google's verification. For a personal install this is acceptable — click
"Advanced" → "Go to <app> (unsafe)". For any public distribution, verify the app
with Google to remove the warning.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `redirect_uri_mismatch` | Callback not registered, or trailing-slash mismatch | Must match §3.2 character-for-character |
| `access_denied` | User declined | Expected; offer a retry |
| `invalid_grant` on refresh | Refresh token revoked | `needs_reauth`; re-consent; do not loop |
| Consent never appears | Account not a test user while in Testing mode | Add the account under *Test users*, or publish the screen |
| Works in dev, fails deployed | Worker subdomain not the registered redirect URI | Register both, or add as a second authorized URI |
| 403 `insufficientPermissions` | Scope not granted | Re-consent incrementally (§5) |

---

*Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [API.md](./API.md) ·
[PLUGINS.md](./PLUGINS.md)*
