# Handoff — 2026-10-02

Where things stand after today's session, written for whoever picks this up
next. For the reasoning behind decisions, see `agent.md` (current state and
invariants) and `IMPLEMENTATION_SUMMARY.md` (chronological session log).

---

## Live right now

| | |
|---|---|
| App | **https://threadmymail.omixsystems.store/app** |
| Pages fallback | `https://threadmymail.pages.dev/app` |
| API origin | `https://threadmymail-worker.twistedoliver211fs.workers.dev` (proxied same-origin at `/v1/*`) |
| Worker version | `b622ff20` (last session deploy — no Worker changes this session) |
| Provider keys stored | **0** — clean slot, nothing to rotate or re-enter |
| HEAD | `c6441fc` — retro design system, committed and pushed |

**The frontend and Worker are deployed.** The retro Win95 design system is live
at the custom domain.

---

## What was done this session

### Google OAuth — now working ✅

The owner completed the first Google consent and the OAuth flow is confirmed
end-to-end. Sign-in works. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are
set as Worker secrets.

**No code was changed for OAuth** — the implementation from the previous session
was already correct. The only missing piece was the owner walking through the
Google consent screen.

### System.jsx — provider/model endpoints fixed ✅

`api.providers()` returns `{ providers, credentials, writable }`, not a flat
array. The component was treating the whole response as the provider list
(always empty) and hardcoding `config` to `null`.

**Fixed:**
- `providers` is now read from `prov.providers`
- `credentials` (the `has_key` status list) is read from `prov.credentials`
- `config` now comes from `api.settings()` which returns `{ ai_config, … }`
- `primary` is read from `config?.ai_config?.primary` (correct path)

File: `frontend/src/pages/System.jsx`

### Deploy script — false positive fixed ✅

The `/v1/skills` proxy check was failing with "FAILED" because it required HTTP
200, but the endpoint correctly returns 401 (unauthenticated). Updated to accept
200 **or** 401 as valid — both prove the proxy is routing to the Worker.

File: `scripts/deploy.sh`

### `oauth_tokens` UNIQUE constraint — applied to Neon ✅

Added `UNIQUE(user_id, provider)` to `oauth_tokens` so that re-auth upserts
cannot create duplicate rows and the callback can safely use `ON CONFLICT`.

Migration: `apps/worker/drizzle/0002_oauth_tokens_unique.sql`
Applied: 1/1 statements, `Schema applied.`

### Logo and favicon — replaced with desired-logo.jpeg ✅

All browser and PWA icon slots now show the desired logo. Assets generated from
`desired-logo.jpeg` (1280×1280 JPEG at the project root) using ImageMagick:

| File | Size | Purpose |
|---|---|---|
| `frontend/public/favicon.ico` | 48×48 | Browser tab icon |
| `frontend/public/logo.svg` | SVG wrapper | `<link rel="icon" type="image/svg+xml">` |
| `frontend/public/pwa-192x192.png` | 192×192 | PWA manifest icon |
| `frontend/public/pwa-192x192-maskable.png` | 192×192 | PWA maskable icon |
| `frontend/public/pwa-512x512.png` | 512×512 | PWA splash / install |
| `frontend/public/pwa-512x512-maskable.png` | 512×512 | PWA maskable splash |
| `frontend/public/apple-touch-icon.png` | 180×180 | iOS home screen |
| `frontend/src/logo.svg` | SVG wrapper | React component usage |

---

## ⚠️ Outstanding items

### 🟡 Cloudflare OAuth expires roughly daily

If `wrangler deploy` fails with auth errors:

```bash
cd apps/worker && ./node_modules/.bin/wrangler login
```

Then re-run `bash scripts/deploy.sh --allow-dirty`.

### 🟡 A real provider key is still needed

Paste one in Settings to enable actual agent runs. User action, not
engineering. Until a key is set, `run` will fail with `NO_API_KEY` /
`NO_MODEL` — that is expected, not a bug.

### 🟡 CI is a Python pipeline

Needs replacing with TypeScript. Not urgent but will cause confusion.

---

## What to build next

1. **Phase 4** — Workflows, real undo, activity feed. This is the next
   engineering phase now that OAuth and BYOK are both working.
2. **A real provider key** (user action) — last thing blocking a live model turn.
3. **CI** — replace the Python pipeline with a TypeScript equivalent.

---

## Deploying

```bash
bash scripts/deploy.sh --allow-dirty   # if untracked files exist
bash scripts/deploy.sh                 # clean tree only
bash scripts/deploy.sh --skip-frontend # API only
```

If auth fails: `cd apps/worker && ./node_modules/.bin/wrangler login`

---

## Invariants that must survive

The eight in `agent.md` are load-bearing. See previous handoffs for detail.
The most dangerous to break accidentally:

- **#1** — an idle heartbeat tick issues zero Postgres queries.
- **#3** — read-after-write must go through `DB_FRESH` / `queryFresh`.
- **#8** — there is no public tool-invocation endpoint.
