# Handoff — 2026-09-30

Where things stand after today's session, written for whoever picks this up
next. For the reasoning behind decisions, see `agent.md` (current state and
invariants) and `IMPLEMENTATION_SUMMARY.md` (chronological session log).

---

## Live right now

| | |
|---|---|
| App | **https://threadmymail.pages.dev/app** |
| API | `https://threadmymail-worker.twistedoliver211fs.workers.dev` |
| Worker version | last successful deploy; `/health` confirms `environment: production` |
| Provider keys stored | **0** — clean slot, nothing to rotate or re-entered |
| HEAD | see `git log --oneline -1` |

**The redesign is deployed and verified.** `scripts/deploy.sh` ran end to end
from a clean tree: Worker deployed, frontend deployed, then checked against
production. Bundle `index-BXfoqg0f.js` / `index-jSzBMj_O.css` confirmed live.

**Nothing is broken.**

---

## The redesign

The Stitch design set was rebuilt as a real three-pane mail client, responsive
from a single codebase rather than eight duplicated mobile screens.

| Design screen | What it is now |
|---|---|
| `ai_dashboard_dark_mode` | `mail/MailShell.jsx` — rail, feed, workstation |
| `desktop_settings` | `app/SettingsPanel.jsx` (lifted, not yet re-skinned) |
| `system_preloader_enclave_init` | **dropped** — it claimed an AWS Nitro Enclave that does not exist |
| `enterprise_admin_dashboard` | **`/system`** — shows real `/health`, providers, usage and model instead of invented user tables |
| `documentation_hub` | **`/docs`** — written from the Worker source, with a "not built" list |
| `privacy_policy` / `terms_of_service` | **`/privacy`**, **`/terms`** — grounded in the real architecture |
| `email_thread_skeleton_decryption_loader` | **`/app`** — plain loading states; there is no decryption step to show off |
| `*_add_account_modal` | **`/app`** connect prompt — states plainly that linking is not built |
| `mobile_*` (8 screens) | the same components at `<768px`; no separate mobile files |
| `landing_page`, `get_started_sign_in` | `pages/Landing.jsx`, `pages/SignIn.jsx` |

### Copy that was removed rather than shipped

The mockup copy made specific, checkable claims this build cannot support:
"SOC2 Type II Certified", "Silk Vault Private Enclave", "AWS Nitro Enclave
Handshake", "within 12 milliseconds", "Traverses 100,000+ past emails",
"Gmail and Outlook", an intelligent quarantine filter, SSN/routing-number
masking, and "3.8 hours"/"14 minutes" of invented time saved. All replaced
with what is implemented.

Kept: the Millo branding, the Silk palette, the typography, and the nav.

### Three bugs a green build did not catch

1. **The icon font was never loaded.** `.ms` set `font-family: 'Material
   Symbols Outlined'` but `index.html` had no stylesheet for it, so every icon
   would have rendered as the literal word `auto_awesome`. The build was green
   throughout.
2. **Eight undefined CSS variables.** `var(--text)` and friends were referenced
   but never declared. An undefined custom property resolves to *nothing*, so
   `color: var(--text)` deleted itself and the element inherited its colour.
3. **`/activity` and `/todos` have no per-item GET.** The detail pane refetched
   the list, passed the array to `Object.entries`, and rendered `[object
   Object]`. The lists now pass the row they already hold.

All three were found by checking, not by watching the build. The checks are
worth repeating after any frontend change:

```bash
# every var() resolves to a declared token
# every className in JSX is defined in some stylesheet
# every Material Symbols name exists in the font
```

The icon check needs Google's `codepoints` file:
`https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutline%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints`

### Not finished

- **`System.jsx` reads the wrong endpoints.** `api.providers()` hits
  `/settings/providers`, which returns the 14-provider catalogue with no
  `has_key` field, so the derived `configured` list is always empty and every
  provider shows "not set". Separately `config` is hard-coded to
  `Promise.resolve(null)`, so the Model section renders "not set" even though
  `/v1/settings` returns `ai_config.primary`.
- **Preloader / enclave-init / decryption loader screens** are still not built.
  They were dropped rather than shipped, because they claimed an AWS Nitro
  Enclave handshake that does not exist. A plain loading state ships instead.

Everything else is native Silk. `styles/legacy-panes.css` is deleted; the four
stylesheets are `silk.css` (tokens + primitives), `mail.css` (the three-pane
grid), `landing.css`, `auth.css`.

### Installable: done, but not yet deployed (commit `e28c4ef`)

A manifest already existed via `vite-plugin-pwa`; what shipped in that commit
was a correction of it plus the install banner.

- `theme_color` was `#2563EB` and `background_color` `#F8FAFC` — both from
  before the Silk redesign, so an installed app got a blue title bar and a
  white splash over a dark UI. Now `#0b1326` / `#060e20`.
- `start_url` was `/`, which opens the marketing page. Now `/app`.
- All five PNGs and the ICO were the old Tailwind blue. Regenerated from the
  Millo mark by `frontend/scripts/make-icons.py` — a pure-stdlib SDF
  rasteriser, so no new dependency and no headless browser. Re-run it after
  changing the mark: `python3 frontend/scripts/make-icons.py`.
- `beforeinstallprompt` is captured at module scope in `main.jsx`, not in an
  effect. The event fires once per engagement and is only cancelable while
  something is listening, so a lazy listener loses it permanently.
- iOS gets the Share → Add to Home Screen instruction, because Safari has no
  install API at all.

**Not deployed** — the Cloudflare OAuth had expired again (see below), so
`scripts/deploy.sh` refused to run. Everything is committed and verified
locally; it needs one `wrangler login` and a re-run.

---

## What was done earlier today

### 1. Provisioned `ENCRYPTION_KEY` in production

Generated with `openssl rand -hex 32`, applied with `wrangler secret bulk` from
a `umask 077` temp file that was shredded immediately after. The file form
rather than `secret put` specifically so the value never enters a terminal
transcript.

This is **infrastructure**, not a model key — `wrangler secret put` is the
correct tool for it, unlike provider keys which are always per-user BYOK.

> **Do not rotate this.** Rotation makes every stored credential
> undecryptable while Settings still lists them as present. There is no
> re-encryption path; keys would have to be re-entered by hand.

### 2. Fixed: one unreadable credential blanked the entire key list

`878dce5`. The first GET after setting `ENCRYPTION_KEY` reported no keys at
all, despite a successful write.

Cause: a dev-only row in the `model:` namespace, sealed with the local dev
key, had reached the shared database. `CredentialStore.status()` decrypted
every row in a single loop, so that one value threw — and the catch that
existed precisely to survive a wrong-key decrypt answered by reporting *every*
provider as unconfigured.

This is the dangerous shape of bug: a user with three good keys and one stale
row would have been told they had configured nothing, with nothing in the UI to
distinguish "wrong key" from "never set one".

Decryption is now per-row. Failures are counted and surfaced as the
endpoint's `reason`, so the UI can name the one that needs re-entering
instead of showing an empty list. Covered by `test/cred_partial_test.mjs`.

### 3. Added CORS, and published the app

`3450a8d`. The frontend had never been deployed — built and committed, but it
had never run anywhere public, and the Worker sent no CORS headers at all, so
a browser would have blocked every call.

**The one hard constraint: CORS is never a wildcard.** Every request is still
attributed to `DEV_USER_ID` with no login, so
`Access-Control-Allow-Origin: *` would let any page in any browser the user
visits read and write that account. `CORS_ORIGINS` enumerates one production
origin and **fails closed** — unset means no headers, which is exactly the
behaviour that existed before.

A disallowed origin gets a 403 on preflight, but a real request is still
*executed*: the browser is what enforces the policy, and hard-rejecting would
break curl, Workers and native clients for no security gain.

### 4. Gave the landing page a way into the app

`998d1c0`. Publishing exposed a bug the marketing page was hiding: every call
to action pointed at `#install` or `#features`, and not one link to `/app` or
`/signin` existed anywhere in the markup. The page had been written when there
was nothing public to open.

Also removed two claims the app can no longer make: the hero promised "One
Google sign-in" (that button 404s — OAuth is deferred) and the badge and
footer still said "PWA Phase 1".

### 5. Made upgrades repeatable and self-verifying

`099a663`, `7fc9ff0`, `0620db4` — `scripts/deploy.sh`. Details below.

---

## ⚠️ Known risks, in priority order

### 🔴 Sign-in cannot complete — one Google Cloud project is left to do

**The public-access hole is closed.** `/app` is gated, every data endpoint
returns 401 without a session, and the `X-User-Id` header that used to let
anyone impersonate the single dev user is ignored in production. Verified
against production on 2026-09-30.

What is missing is the other half. `SESSION_SECRET` is provisioned
(`openssl rand -hex 32`, sealed with `secret bulk`). **`GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are not set**, so:

- `GET /v1/auth/session` → `200 {"authenticated":false,"dev_mode":false}` — correct
- `GET /v1/auth/google` → `503 NOT_CONFIGURED: GOOGLE_CLIENT_ID is unset`

The app is therefore in the secure-but-unusable state: locked, and no way in.
To finish it, in the [Google Cloud console](https://console.cloud.google.com/apis/credentials):

1. Create a project (or pick an existing one).
2. Enable the **Google Drive API**, **Gmail API** and **Google Calendar API**.
3. OAuth consent screen → **External** → add `marvel.254@gmail.com` as a test user.
4. Credentials → **OAuth client ID** → **Web application**.
5. Authorised redirect URI, exactly: `https://threadmymail-worker.twistedoliver211fs.workers.dev/v1/auth/google/callback`
6. Then:
   ```bash
   cd apps/worker
   printf '{"GOOGLE_CLIENT_ID":"…","GOOGLE_CLIENT_SECRET":"…"}' > /tmp/g.json
   chmod 600 /tmp/g.json
   ./node_modules/.bin/wrangler secret bulk /tmp/g.json
   shred -u /tmp/g.json
   ```

`wrangler.jsonc` already has `GOOGLE_REDIRECT_URI` set to that same URI.

**A first login creates a *new* `users` row.** The dev user's existing todos
and skills belong to a different account and will not appear.

### 🟡 `oauth_tokens` has no UNIQUE constraint

`drizzle/0000_initial.sql` creates a plain index on `(user_id, provider)`, not
a UNIQUE constraint, so `ON CONFLICT` is unavailable and token storage is a
select-then-write inside a transaction instead. That is correct but racy: two
concurrent callbacks for the same user can leave two refresh tokens, and the
loser is whichever row the reader happens to see first.

The fix is one statement against live Neon:
`CREATE UNIQUE INDEX oauth_tokens_user_provider ON oauth_tokens (user_id, provider);`
Not run unilaterally — it is a live-schema change.

### 🟡 Cloudflare OAuth expires roughly daily

Both `~/.wrangler/config/default.toml` and `~/.config/.wrangler/config/default.toml`
returned **HTTP 403 "Invalid access token"** mid-session and blocked the
redesign deploy until `wrangler login` was re-run. Production was never
affected — it kept serving the last good build the whole time.

Expect this before the next deploy. If the auth step fails, run
**`wrangler login` from `apps/worker`**. Note that a global `wrangler` may be a
different version from the pinned binary in `apps/worker/node_modules`, and it
writes its token to whichever config *it* uses — so run it from that directory.

This bit again on 2026-09-30 and left commit `e28c4ef` (the PWA work) sitting
on `main` undeployed. Both config files were stale and no `CLOUDFLARE_API_TOKEN`
was in the environment, so there was no way around it but the browser. When
this happens the tree is still clean and the build still passes — re-running
`scripts/deploy.sh` after the login is the whole recovery.

### 🟡 Two wrangler credential locations, and only one works

`~/.wrangler/config/default.toml` and `~/.config/.wrangler/config/default.toml`
belong to different wrangler versions. `wrangler login` writes to whichever one
the binary you typed uses, so a fresh login can leave a stale 403-ing token
sitting untouched in the other. The `expiration_time` inside those files is not
trustworthy either — it can advertise a stale value while the token next to it
works fine.

`scripts/deploy.sh` handles this: it tries each candidate and calls the API,
accepting a token only if it authenticates right now. If you ever see the auth
step fail, run **`wrangler login` from `apps/worker`** so the login lands where
the pinned binary reads it.

### 🟡 A real provider key is still needed

The encrypt → store → decrypt → dispatch path is fully verified, but no live
model turn has run because there is no key. Paste one in Settings. This is a
user action, not engineering.

### 🟡 Local dev writes to the same database as production

`apps/worker/.dev.vars` points at the shared Neon instance, so anything saved
in local dev is encrypted with the *dev* key and unreadable in production.
This is exactly what produced the bug in item 2. Consider pointing local dev
at a separate database before experimenting with credentials.

### 🟡 Armed schedule entries can linger

An armed (event-triggered) row in the DO's SQLite is never claimed, so a skill
deleted outside this API lingers until the next cursor advance or a
`POST /skills/sync`. Bounded to one row; the repair path exists; judged not
worth a watcher.

---

## Deploying

```bash
bash scripts/deploy.sh                  # Worker + frontend, then verify
bash scripts/deploy.sh --skip-frontend  # API only
bash scripts/deploy.sh --allow-dirty    # deploy uncommitted changes
```

It refuses a dirty tree by default, typechecks, builds, deploys the Worker
**first** (so the frontend is never published ahead of its API), deploys the
frontend, and then **verifies behaviour rather than trusting the CLI**:
`/health` must report `environment: production` and
`credentials_encrypted: true`, the Pages origin must be echoed by CORS, and
`/app` must serve 200.

Two steps fail in ways that are easy to miss, and the script now handles both:

- **Vite inlines `VITE_*` at build time.** Without them the bundle calls `/v1`
  on `pages.dev`, where no Worker exists — the site loads and every request
  404s, which reads as a backend outage rather than a build mistake. The script
  sets them and asserts the API origin is in the bundle before publishing.
- **`wrangler pages deploy` will not use its own OAuth token
  non-interactively** and demands `CLOUDFLARE_API_TOKEN`. Passing the OAuth
  token through that variable works — but **only for that one command**.
  Exporting it globally breaks the Worker deploy, which rejects it with
  `9109`.

Use the wrangler pinned in `apps/worker/node_modules/.bin`, not a global or
root `npx wrangler`. If auth fails, `wrangler login` from `apps/worker`.

### Database migrations

Deliberately **not** part of `scripts/deploy.sh`. They change data, re-running
the script does not undo them, and they need a human to read the SQL first:

```bash
node apps/worker/scripts/db-push.mjs drizzle/0000_initial.sql --dry-run
node apps/worker/scripts/db-push.mjs drizzle/0000_initial.sql
```

---

## Testing

`bash apps/worker/scripts/run-tests.sh` — **149 tests, 5 suites, all passing.**

The script discovers `test/*_test.mjs` itself. Do not hardcode the list: an
earlier version defaulted to two suite names and printed "34 passed" while
skipping the other 115. A runner that under-reports reads as a green light.

Node strips types but does not rewrite the `.js` specifiers the source uses for
ESM, so the script bundles each test with esbuild first.

```bash
cd apps/worker
npm run typecheck          # must be run from apps/worker, not the repo root

for f in test/*.mjs; do node "$f"; done
```

`sched_test.mjs` (98) · `quiet_test.mjs` (8) · `cred_partial_test.mjs` (9).
Root `npx tsc` false-positives; typecheck from `apps/worker`.

---

## What to build next

1. **Google OAuth** — closes the 🔴 above. `/auth/google`, the callback, the
   session cookie, and the gate on `/app`. It is the only thing making the
   published URL safe to share, which makes it more urgent than its position in
   the plan suggests.
2. **A real provider key** (user action) — the last thing blocking a live
   model turn.
3. **Phase 4** — workflows, real undo, activity feed. The groundwork exists:
   the `activity` table already has `undo_ref` and `undone_at` columns waiting
   to be used, and the kill switch, dry-run shadowing and budgets are in place.

---

## Invariants that must survive

The eight in `agent.md` are load-bearing. Two are easy to break by accident
during a refactor:

- **#1 — an idle heartbeat tick issues zero Postgres queries.** The parked
  `schedule` table in the DO exists so that a 5-minute tick reads only
  DO-local state. If you ever add a Postgres read to `runHeartbeat`, Neon can
  no longer suspend between ticks. *Proven, not asserted: a poison-database test
  replaces `pg` with a stub that records every call, and an idle tick issues
  literally zero.*
- **#3 — read-after-write must go through `DB_FRESH` / `queryFresh`.** The
  cached pool is up to 60 seconds stale. This is why a credential write that
  returned `has_key: true` appeared not to have saved.

Also: **#8 — there is no public tool-invocation endpoint.** Tools are
reachable only through the agent. Do not add one.
