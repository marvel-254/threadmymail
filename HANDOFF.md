# Handoff — 2026-09-29

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
| Provider keys stored | **0** — clean slot, nothing to rotate or re-enter |
| HEAD | see `git log --oneline -1` |

**Nothing is broken and nothing is half-deployed.** Everything committed today
is live and verified, and `scripts/deploy.sh` has been run end to end from a
clean tree: Worker deployed, frontend deployed, then verified against
production.

---

## What was done today

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

### 🔴 Published with no authentication

`threadmymail.pages.dev` is public and every request is attributed to a single
hardcoded user. **Anyone with the URL has that account** — todos, skills, and
the credential store. CORS limits which *browser* can reach the API; it does
nothing about the URL being guessable.

Treat the URL as a shared password. **Google OAuth is the only thing that
fixes this**, and it is the next thing to build.

### 🔴 The sign-in button is a dead end

`/signin` renders "Continue with Google", which navigates to
`/v1/auth/google` → **404**. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are
declared in `Env` but nothing reads them, and there is no `/auth/*` route in
the Worker. `/app` is not gated at all.

This is expected — OAuth is deferred to the last item of the final phase by
explicit decision (2026-09-28) — but it means the deployed UI advertises a
login that does not exist.

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
