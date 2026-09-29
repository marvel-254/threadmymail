# Implementation Status

> **Last updated:** 2026-09-28
> **Status:** Phase 0 complete, Phase 1 code-complete + deployed (v0.2.0).
> Phase 2 (Gmail/todo tools, artifact bindings) in progress.

---

## Where things actually are

| Area | State |
|---|---|
| Product definition | ✅ Complete — [PLAN.md](docs/PLAN.md) |
| Architecture | ✅ Complete — [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| AI layer design | ✅ Complete — [AI-SKILLS.md](docs/AI-SKILLS.md) |
| Plugin system design | ✅ Complete — [PLUGINS.md](docs/PLUGINS.md) |
| API surface | ✅ Complete — [API.md](docs/API.md) |
| **Phase 0 CPU spike** | ✅ **PASSED** — DO budget ≫ 10 ms on Free |
| **Phase 1 agent runtime** | ✅ Code complete, typechecks, **deployed as v0.2.0** (`/health` → `ok`) |
| Tool registry (**36 tools**) | ✅ Registered; 22 executable, 14 gated on the Google connection |
| REST API (todos/memory/settings/skills) | ✅ Verified live against real Neon via Hyperdrive |
| **REST API (email/calendar)** | ✅ **Every route and branch verified live** — 200/400/404/501/503 all match API.md (fixture script reproduces the connected/reauth states) |
| **PWA icons** | ✅ Generated; install no longer shows a broken icon (was a blocker) |
| OpenRouter model client | ✅ Written (streaming + tool calls). Untested — key is entered in-app (not set yet) |
| **Body storage (D1)** | ✅ Created; 2.5 MB chunked object round-trips byte-for-byte |
| **Neon database** | ✅ Provisioned, schema applied |
| **Worker + Durable Object** | ✅ Deployed (spike build) |
| Frontend agent shell | ✅ Built — `/app` route |
| Frontend landing page | ✅ Preserved at `/` |
| **Email/calendar tools** | ✅ Registered — local readers real, Google calls gated (Phase 2) |
| Skills engine / heartbeat code | ❌ Not started (Phase 3+) |
| Plugin code | ❌ Not started (Phase 7) |
| Backend (`backend/`) | ❌ Superseded Python. Not part of the build. |
| Mobile | ❌ Nothing but a build guide |

---

## ✅ Done

### Phase 0 — the gate that mattered

**Durable Objects on the Free plan have a CPU budget far above the 10 ms Workers
cap.** A DO completed **40,000,000 iterations** of real CPU work, with
**400/400 chunks checkpointed** into SQLite storage — and that checkpoint is
proof the loop genuinely ran, since storage survives a hard CPU kill. Both cron
triggers fire in production (`ok: true`).

**The architecture is viable on Cloudflare Free.** Full results and the
measurement trap that produced a false negative on the first attempt:
[ARCHITECTURE.md §11](docs/ARCHITECTURE.md).

### Infrastructure

- **Neon:** project `threadmymail`, region `aws-eu-central-1` (Frankfurt — closest
  to EAT), PostgreSQL 17.11, `vector` 0.8.0 + `pg_trgm` enabled.
- **Schema:** 14 tables, 36 indexes, `ivfflat` vector indexes on
  `memories.embedding` and `email_messages.embedding`. **No email bodies in
  Postgres** — only `body_key` pointers to the D1 body store.
- **Worker:** `https://threadmymail-worker.twistedoliver211fs.workers.dev`
  with a Durable Object (SQLite backend), two cron triggers, and the spike harness.
- **Frontend:** agent shell built — Stream, Today, Activity, Skills, Plugins,
  `⌘K` command bar, kill switch, and the sandboxed artifact frame with its
  binding allowlist. Build green; landing page preserved verbatim at `/`.

### Phase 2 — Gmail tools, toolbar surface, artifact bindings (in progress)

**Tool inventory: 36 registered.** `todo.*` 8 · `memory.*` 5 · `meta` 4 ·
`email.*` 11 · `calendar.*` 8.

- **`tools/email.ts`** — `email.search`, `email.get`, `email.get_thread` are
  **real implementations** against the synced projection (`email_messages` in
  Neon, bodies in D1 via `body_key`, truncated on read). The eight mutating
  tools (`draft`, `send`, `reply`, `archive`, `label`, `mark_read`, `snooze`,
  `extract_attachments`) are registered and fully described, but gated.
- **`tools/calendar.ts`** — all eight calendar tools are gated: nothing syncs
  the calendar locally, so every one is a live Google call.
- **`tools/gated.ts`** — the shared factory for "specified, described, and
  honest about not running yet". A gated tool checks the real connection at call
  time: no connection → `NEEDS_CONNECTION`; connected but unimplemented →
  `NOT_IMPLEMENTED`. It never reports success.
- **`http/routes.ts`** — new `/emails` surface (metadata list with keyset
  cursor, single message with body from D1, thread) and `/calendar/*`. Every
  Google-dependent endpoint reports the true state — 503 `NEEDS_CONNECTION` or
  501 `NOT_IMPLEMENTED` — instead of 404 (reads as a typo) or an empty 200
  (reads as "you have no mail", which is a lie the user cannot act on).
  `/emails/sync/status` always answers, so the UI can say *connect Google*.
- Body reads are capped at 20 000 chars in both the tool and the REST layer.
- `email.search` escapes `ILIKE` metacharacters, so a query of `100%` is a
  literal, not a wildcard.
- `EMAIL_METADATA_COLUMNS` lives in `db/client.ts` and is shared by the REST
  layer and the tools, so the two cannot drift on what a list may expose
  (`body_key` and `embedding` are excluded).

**Verified:** `tsc --noEmit` clean · `wrangler deploy --dry-run` bundles
(398 KiB) with all bindings resolving, including both Hyperdrive configs ·
frontend `vite build` green.

**Not verified:** no live request has exercised the new routes (they need a
connection row or a deployed build), and the model client still cannot complete
a turn until a key is saved in-app.

### Design

- Reframed the product: an AI assistant that owns mail/calendar/tasks
- Settled hosting on Cloudflare; rejected Render (spin-down) and Vercel (daily-only cron)
- Replaced IMAP with the Gmail API; magic links with a single Google consent
- Designed the tool registry, skill system, subagents, memory, and autonomy guardrails
- Designed the artifact/binding protocol and the plugin manifest + permission model
- Settled on **$0/month** infrastructure, with a $5 Workers Paid escape hatch

---

## ⏳ Next: Phase 2 remainder → Phase 3

**Phase 1 (the agent exists) is done** — the table below is kept for the record;
1.4–1.7 are complete, 1.8 is split, 1.9 is the open item that unblocks real
completions.

### Phase 2 remainder (current)

| # | Task | Done when |
|---|---|---|
| 2.1 | ~~`email.*` / `calendar.*` tools~~ | ✅ Registered — local readers real, Google calls gated |
| 2.2 | ~~`/emails`, `/calendar/*` routes~~ | ✅ Implemented with honest 503/501 states |
| 2.3 | ~~PWA icon blocker~~ | ✅ Generated from `logo.svg`, build green |
| 2.4 | `/cal/events` binding verb (`event.rsvp`) | Currently a deliberate client-side `NOT_IMPLEMENTED` (Phase 5) |
| 2.5 | Tool listing endpoint | `GET /tools` exists in `index.ts` — confirm it lists all 36 |
| 2.6 | `agent/runs` + `agent/stream` REST surface | Frontend `api.js` declares them; only WebSocket exists |

### Phase 1 remainder (record)

| # | Task | Done when |
|---|---|---|
| ~~1.1~~ | ~~Wire Hyperdrive (`DB` cached + `DB_FRESH` cache-disabled) to Neon~~ | ✅ Both bindings resolve in the deploy manifest |
| ~~1.2~~ | ~~R2 buckets~~ | ✅ **Replaced by D1 — no card needed** |
| ~~1.3~~ | ~~Drizzle client + migration runner~~ | ✅ `drizzle/` schema + `scripts/db-push.mjs` (CI wiring still Python) |
| ~~1.4~~ | ~~Tool registry (`email.*`, `todo.*`, `memory.*`, `meta`)~~ | ✅ 36 tools registered |
| ~~1.5~~ | ~~Agent loop on the DO: persona, stream, step cap, tool execution~~ | ✅ `agent/loop.ts` + `agent/durable.ts` |
| ~~1.6~~ | ~~`agent_runs` / `tool_calls` persistence~~ | ✅ Every run and tool call logged |
| ~~1.7~~ | ~~WebSocket `/v1/agent/stream`~~ | ✅ In `index.ts`; consumed by `lib/ws.js` |
| ~~1.8~~ | ~~Secrets: OpenRouter~~ | ❌ **Superseded — key is in-app per-user BYOK, see decisions below** |
| 1.8 | Secrets: `ENCRYPTION_KEY`, `SESSION_SECRET` | Set (needed to encrypt the in-app key) |
| 1.9 | **Settings-panel model key entry** (per-user, encrypted, all providers) | ✅ **Built 2026-09-29** — 14 providers + `custom`; keys never returned by the API |
| 1.9a | **`ENCRYPTION_KEY` provisioned in production** | 🔴 **Outstanding.** `npx wrangler secret put ENCRYPTION_KEY`. Infra, not a model key. Without it the panel is read-only. |
| ~~1.10~~ | ~~Google OAuth client + secret~~ | ❌ **Deferred to the last item of the final phase** |

### Decisions locked (2026-09-28, by user)

1. **Model keys are entered by the user in the app's own Settings panel — NOT
   `wrangler secret put`.** They are per-user BYOK keys stored encrypted in
   `plugin_credentials` under the `model:` namespace (see
   `agent/config.ts` header and [ARCHITECTURE.md §12](docs/ARCHITECTURE.md)).
   There is **no** `OPENROUTER_API_KEY` binding in `Env` at all — one shared
   key would mean shared billing and a hidden cost. `/health` now reports
   `credentials_encrypted` (whether the Worker *can* store keys), never
   anything about a user's keys. **Generalised 2026-09-29 from OpenRouter-only
   to all providers** — see "Multi-provider model routing" below.
2. **Google OAuth is the LAST item of the FINAL phase.** Auth endpoints
   (`/auth/google`, callback, session) are deferred to the end of the
   roadmap — until then `DEV_USER_ID` in `routes.ts` is the deliberate
   stand-in. Do not build auth early.
3. **`ENCRYPTION_KEY` is infrastructure and must be set with
   `wrangler secret put`.** It is not a model key; there is no in-app way to
   provision it and it cannot be derived from user data. This is the *only*
   secret in the model path.

### Still needed from the user

- ✅ **No card needed.** R2 was replaced with D1, which has no payment-method
  requirement.
- 🔴 **`ENCRYPTION_KEY` in production** — one command, infrastructure only:
  `npx wrangler secret put ENCRYPTION_KEY`. Until it is set the Settings
  provider list is visible but read-only, and a run fails with `NO_API_KEY`.
  (Verified 2026-09-29 against the live Worker: `/settings/providers` →
  `writable: false`.)
- 🔑 **A real provider key**, pasted into the app's Settings panel. The UI and
  the whole encrypt→store→decrypt→dispatch path are done and verified; a live
  model turn is blocked only on this.
- 🟡 **Google OAuth** client ID + secret — final phase only, not now.

---

## 🗓 Roadmap

| Phase | Deliverable | Verified by |
|---|---|---|
| **0** | Foundation + CPU spike | ✅ **PASSED** |
| 1 | Agent runtime, tool registry, streaming chat | You can talk to it and watch tool calls |
| 2 | Gmail tools, todo tools, artifact bindings | It reads mail; a checkbox is a real write it knows about |
| 3 | Heartbeat, skill engine, morning briefing | It acts before you open the app |
| 4 | Workflows, budgets, kill switch, undo, activity feed | Kill switch stops a run; undo reverses a send |
| 5 | Calendar: freebusy, booking, watch, prep | "Find 30min with Dana and Alex" → real slots → booked |
| 6 | Subagents + memory + pgvector RAG | It recalls an old commitment unprompted |
| 7 | Plugins + built-ins (Notion, Exa, Firecrawl) | Install a plugin, approve it, the agent uses it |
| 8 | Mobile APK + push | A push opens the right thread |
| 8 (last item) | **Google OAuth** (sign-in, sessions, token storage) | Real users, not `DEV_USER_ID` |

> **OAuth is deliberately the last item of the last phase** (user decision,
> 2026-09-28). Everything before it stays user-scoped so swapping
> `DEV_USER_ID` for a session principal is a one-line change.

---

## ⚠️ Environment gotchas (learned the hard way)

| Issue | Impact | Action |
|---|---|---|
| **`Date.now()` and `performance.now()` have no resolution inside a DO in production** | A 3.4 s probe reported `elapsed_ms: 0`, producing a **false negative verdict** | Use completion as the signal; read `/spike/progress` for checkpoints. Never trust duration. |
| **Node `fetch` fails IPv6 on this machine** | `ENETUNREACH`, no fallback to IPv4. curl falls back; undici does not | Use `node:https` with `family: 4` — see `apps/worker/scripts/db-push.mjs` |
| **Node's Happy-Eyeballs family autoselection breaks every local Hyperdrive connect on this machine** | `AggregateError [ETIMEDOUT]` on 100% of attempts while `bash` reached the same host 5/5. `--dns-result-order=ipv4first` alone does **not** fix it | `npm run dev` (scripts/dev.sh) sets `NODE_OPTIONS=--no-network-family-autoselection` for you |
| **A failed Hyperdrive-local connect kills `wrangler dev` outright** | The unhandled `AggregateError` deadlocks esbuild's watcher (`fatal error: all goroutines are asleep`), so one bad request takes the whole server down and later requests get no response at all | Don't read that deadlock as a code fault — fix the connection and restart |
| **Hyperdrive local connection strings must be in the shell env, not just `.dev.vars`** | `wrangler dev` exits with "you should use a local Postgres connection string" even though the values are in `.dev.vars` — wrangler validates them *before* it applies that file | `npm run dev` (scripts/dev.sh) exports `.dev.vars` into the shell before starting wrangler |
| **`sslmode=disable` on a *remote* Postgres is refused by `pg`** | Every Postgres route 500s with `connection is insecure (try using 'sslmode=require')` — this hit `/todos`, `/settings` and `/emails*` alike | Use `sslmode=require` (Neon); `disable` is only safe against real localhost |
| Network to Cloudflare and Neon is intermittent | `fetch failed` on deploys | Retry with a long timeout; it usually succeeds on attempt 2 |
| `wrangler whoami` takes 60–90 s (was 8 s for the user) | A 30 s timeout is a guaranteed false negative | Use ≥90 s, or just read the deploy output |
| An `ai` binding breaks `wrangler dev` non-interactively | It opens a remote proxy session and deadlocks | No `ai` binding — model access is BYOK via OpenRouter |
| `wrangler.jsonc` needs a `migrations` entry for a new DO class | Deploy fails with `code: 10061` | `new_sqlite_classes: ["AgentObject"]` |
| `@cloudflare/workers-types` must be **v5** for wrangler 4.142 | `npm install` ERESOLVE failure | Keep both on the same major |
| npm 12 blocks postinstall scripts by default | esbuild/workerd silently unusable | `npm install-scripts approve esbuild workerd` |
| CI still runs a Python pipeline | Will fail now `backend/` is dead | Replace with a TypeScript pipeline |

### Stray artifacts (now ignored, still on disk)

- `--output` — a stray PNG from a mistyped command.
- `landing-preview.png`, `logo-preview.png`, `adapted-preview*.png`.

Matched by `.gitignore`, so they no longer show up in `git status`. Delete them
when convenient — they are not referenced by anything.

---

## 📓 Session log

Append here after any session that changes code or docs. Keep it short: what
changed, how it was verified, what is left. This is how the next agent picks up
without re-deriving anything.

### 2026-09-29 — multi-provider model routing (BYOK for all providers)

**Started from:** `aa4319e` (REST runs + unified pipeline). The OpenRouter-only
Settings UI existed but had no backend behind it — `SettingsPanel.jsx` was
writing five hard-coded `pluginCredentials(...)` calls that no route served.

**New files**
- `apps/worker/src/agent/providers.ts` — the catalogue: 14 providers + `custom`
  + `ollama`, each with `{dialect, baseUrl, keyHint, suggestPrimary,
  suggestBackground, keyUrl, local?, custom?}`. Only **two** wire dialects
  (`openai`, `anthropic`) — nearly every provider speaks OpenAI Chat
  Completions, and Google uses its `v1beta/openai` compatibility endpoint, so a
  third dialect would have bought nothing. Holds `validateBaseUrl` (the SSRF
  rules) and `validateApiKey`.
- `apps/worker/src/agent/crypto.ts` — AES-GCM via WebCrypto, key = SHA-256 of
  `ENCRYPTION_KEY`, stored `v1.<iv>.<ct>`. **Fails closed**: a missing or
  <16-char key throws rather than storing plaintext. A foreign version degrades
  to "no key"; a *wrong* key throws, because that is operator error and must be
  loud. Plus `fingerprint()` (8 hex of a salted hash) for the UI.
- `apps/worker/src/db/credentials.ts` — per-user store in the **existing**
  `plugin_credentials` table under a reserved `model:<provider>` namespace, keys
  `api_key` / `base_url`. **No migration**: that table already has exactly the
  right shape and ARCHITECTURE §12 already calls the model key a plugin
  credential. `resolveBaseUrl()` centralises the precedence rules.

**Changed**
- `agent/model.ts` — rewritten as a stateless transport taking a `ModelTarget`
  instead of a model name, with both dialects streaming. Tool calling is a hard
  requirement (no buffered fallback without re-measuring CPU), so tool schemas
  are translated per dialect — Anthropic's `input_schema`, its out-of-band
  `system` field, and its `partial_json` tool stream are all handled.
- `agent/loop.ts` — `pickModel` became `pickSlotConfig` + `resolveTarget`; the
  credential is read once per run, not per step, and never logged.
- `agent/{config,persona}.ts` — `ModelConfig` gains `provider` and `baseUrl`;
  `normalizeModel` drops an unknown provider id to the default rather than
  letting a typo become an unroutable request.
- `http/routes.ts` — `GET /settings/providers`, `PUT`/`DELETE
  /settings/providers/:provider`, `POST /settings/providers/:provider/test`, and
  `validateAiConfigPatch` on `PUT /settings`.
- `index.ts` — **removed the `OPENROUTER_API_KEY` binding.** It was never
  read, and keeping it implied a supported config path the docs forbid.
  `/health` now reports `credentials_encrypted` instead of `has_model_key`.
- `frontend/` — provider picker per slot, per-provider key management with
  `key saved (fingerprint)` indicators, custom base URL, and a Test button.

**Two bugs found and fixed during verification** (both were mine):
1. `GET /settings/providers` reported `writable: true` on a Worker with **no**
   `ENCRYPTION_KEY`. `status()` only entered the decrypt path when rows existed,
   so an empty table never detected the missing key. Added an eager
   `assertConfigured()`.
2. **SSRF hole.** `PUT /settings` merge-patches `ai_config` as raw jsonb with no
   validation, and the new `baseUrl` took precedence over the provider's
   registered URL — so `ai_config.primary.baseUrl = "http://169.254.169.254/…"`
   would have been persisted and *fetched with the user's key in the header*.
   Fixed twice over: `validateAiConfigPatch` rejects it at write time with the
   same https/loopback rule, and `resolveBaseUrl` now honours a slot-level
   override **only** for `custom`/`local` providers.

**Verified**
- `tsc --noEmit` clean; `vite build` clean; deployed `b3eadc2f` (430 KiB).
- Live: 14 providers listed, `writable: false` with a real reason, SSRF
  rejection, unknown-provider 404, short-key 400, credential write → 503
  `ENCRYPTION_UNAVAILABLE` (not a silent no-op), 36 tools unchanged.
- Local (`wrangler dev` + real Neon): full round trip — save → status shows
  `has_key` + fingerprint → rotate changes fingerprint → clear base URL →
  delete. No response ever contained the key.
- Crypto: round trip, unique ciphertext per write, wrong key throws, foreign
  version → null, fingerprint stable/differing.
- **Both dialects, 24 assertions** against a stubbed `fetch` — request shape,
  `x-api-key`, `anthropic-version`, system split, `input_schema` renaming,
  fragmented tool-argument reassembly, usage mapping, and the `NO_API_KEY` /
  `NO_MODEL` / `UNKNOWN_PROVIDER` / `BAD_TOOL_ARGS` guards.
- **End to end through a mock provider**: an agent run streamed a fragmented
  tool call, reassembled `{"title":"buy milk"}`, dispatched `todo.create`, and
  wrote 3 real rows to Postgres. All test data then deleted and `ai_config`
  restored.

**Left**
- 🔴 `ENCRYPTION_KEY` is **not** set in production. One command, infrastructure
  only: `npx wrangler secret put ENCRYPTION_KEY`. Until then the panel is
  read-only.
- 🔑 A real provider key pasted into the panel — the only thing blocking a live
  model turn.
- Next: **Phase 3** (heartbeat + skills engine). The heartbeat must stay
  DO-local — read `sync_state.history_id` and the kill switch, zero Postgres —
  to preserve invariant 1.

### 2026-09-28 — commit the tree, fix PWA icons, Phase 2 groundwork

**Decisions taken (by user, recorded in `docs/PLAN.md` §9):**
1. The OpenRouter key is entered **in the app's Settings panel**, per-user BYOK
   — never `wrangler secret put`. `has_model_key: false` on `/health` is
   expected, not a fault.
2. **Google OAuth is the last item of the final phase.** Nothing may build auth
   early, and `DEV_USER_ID` stays until then.

**Done**
- **Committed the whole tree** — it had 5 commits and ~72 dirty/untracked files.
  Four commits: worker runtime · frontend shell · docs v2 + audits ·
  chore/legacy. Working tree is clean; secrets were checked before staging
  (`.dev.vars` is ignored, the example file is empty-valued).
- **PWA blocker fixed** (audit item #1). `vite.config.ts` declared
  `pwa-192/512.png` and referenced `favicon.ico`/`apple-touch-icon.png`, none of
  which existed. Rendered from `logo.svg` with `rsvg-convert`: 192/512 standard,
  192/512 maskable (logo in the 80% safe zone on a solid field), 180
  apple-touch, and a 16/32/48 `favicon.ico`. `theme_color` unified to `#2563EB`
  and `background_color` to `#F8FAFC`. Precaching went 6 → 18 entries; icons
  verified non-blank.
- **Phase 2 tools** — see the Phase 2 section above. 36 tools registered;
  `tools/gated.ts` added as the pattern for Google-dependent capabilities.
- **Phase 2 routes** — `/emails*` and `/calendar/*` implemented with truthful
  503/501 states; `/emails/sync/status` always answers so the UI can render
  *connect Google*.

**Verified:** `tsc --noEmit` clean · `wrangler deploy --dry-run` bundles
(398 KiB, all bindings resolve incl. both Hyperdrive configs) · frontend
`vite build` green · manifest + precache inspected.

**Not verified:** no live request has hit the new routes; the agent still
cannot complete a turn (no in-app key yet).

**Next:** the Settings-panel key entry (1.9) unblocks real completions. Then
Phase 2 remainder (2.4–2.6) and Phase 3.

### 2026-09-28 — email/calendar routes verified against a live local worker

**Ran:** `wrangler dev` on `:8787` and exercised every new route. The first
attempts failed for reasons unrelated to the new code (see the gotchas table —
all four were local-dev problems, and two of them broke `/todos` as well).

**Result — the surface matches [docs/API.md](docs/API.md) exactly:**

| Request | Response |
|---|---|
| `GET /health` | 200 `{version:"0.2.0", has_model_key:false}` |
| `GET /emails/sync/status` | 200 `{connected:false, needs_reauth:false, last_sync_at:null, last_history_id:null, last_error:null}` — always answers |
| `GET /emails` (also `?q=`, `unread`, `limit`, `cursor`) | 503 `NEEDS_CONNECTION` |
| `GET /emails/:id`, `GET /emails/:id/thread` | 503 `NEEDS_CONNECTION` |
| `POST /emails/sync` | 503 `NEEDS_CONNECTION` |
| `POST /emails/:id/{read,archive,label}` | 503 `NEEDS_CONNECTION` |
| `GET /calendar/{events,freebusy}` with no `from`/`to` | 400 `INVALID_ARGS` |
| `GET /calendar/{events,freebusy}` with a range | 503 `NEEDS_CONNECTION` |
| `GET /calendar/agent-created` | 503 `NEEDS_CONNECTION` |
| `GET /v1/emails/sync/status` | 200 — the stripped `/v1` prefix resolves too |

`/tools` lists all **36** tools, including 11 `email.*` and 8 `calendar.*`. The
Postgres path is genuinely live, not merely bound: `GET /todos` returned a real
row from Neon through `DB_FRESH`, so the previously-open question "do the
Hyperdrive configs resolve?" is now answered — yes, locally.

**Not exercised:** the `501 NOT_IMPLEMENTED` and `503 NEEDS_REAUTH` branches.
Both need a row in `oauth_tokens`, and no write was made to the dev database to
produce one. Everything else on the gated surface is confirmed by live request.

**One ordering nit — FIXED (see the last session-log entry):**
`GET /emails/not-a-uuid` originally answered `503 NEEDS_CONNECTION`, not
`400 INVALID_ARGS`, because `assertGoogle()` ran before `uuidParam()`. All five
`/emails/:id` routes now validate the id first, so a malformed id is reported
as `INVALID_ARGS` in every connection state.

**Local-dev fixes made to get here** (`sslmode` fix is in the gitignored
`.dev.vars`; the rest is documented):
- **One command now works: `npm run dev`** (via new `apps/worker/scripts/dev.sh`).
  It exports `.dev.vars` into the shell, appends
  `--no-network-family-autoselection` to `NODE_OPTIONS`, and execs
  `wrangler dev --port 8787 --ip 127.0.0.1` (override with `TMM_PORT` or extra
  args; `npm run dev -- --remote` skips the local-only flags). `dev:remote`
  routes through it too.
- The Hyperdrive-local strings pointed at remote Neon with `sslmode=disable`;
  `pg` refuses that. Changed to `sslmode=require`. **This was pre-existing and
  affected every Postgres route, not just the new ones.**
- The Hyperdrive-local strings pointed at remote Neon with `sslmode=disable`;
  `pg` refuses that. Changed to `sslmode=require`. **This was pre-existing and
  affected every Postgres route, not just the new ones.**
- `wrangler.jsonc` claimed setting those vars in `.dev.vars` was sufficient.
  It is not — comment corrected; `.dev.vars.example` now carries the working
  invocation.
- The `NODE_OPTIONS` workaround is recorded in the gotchas table above.

**Next:** unchanged — the Settings-panel key entry (1.9) is what unblocks real
completions. The Phase 2 build itself is now the last untested step, and
`wrangler deploy` is the only way to exercise it for real.

### 2026-09-28 — one-command local dev (`npm run dev`)

**Done:** new `apps/worker/scripts/dev.sh`, wired as `npm run dev` (and
`dev:remote`). It exists because a plain `wrangler dev` fails twice on this
machine — Hyperdrive-local strings not exported from `.dev.vars`, and Node's
Happy-Eyeballs autoselection timing out 100% of local Hyperdrive connects. The
script exports `.dev.vars`, appends
`--no-network-family-autoselection` to any existing `NODE_OPTIONS`, then execs
`wrangler dev --port ${TMM_PORT:-8787} --ip 127.0.0.1` with extra args
forwarded; `--remote` bypasses the local-only flags. Gotcha rows in this file
now point at the script instead of the manual invocation. One trap found while
building it: `export "KEY=\"value\""` keeps the quote characters in the value —
the script strips one matching quote pair itself, otherwise wrangler dies with
`Invalid URL` on the Hyperdrive strings.

**Verified:** started via `npm run dev`, polled ready, `/health` 200,
`/emails/sync/status` 200 twice, `/calendar/events` 400 `INVALID_ARGS`, clean
shutdown on SIGTERM (port free, no stray processes), extra-arg forwarding
reaches wrangler (`--help` prints its usage).

**Next:** unchanged — the Settings-panel key entry (1.9) is what unblocks real
completions.

### 2026-09-28 — 501 / NEEDS_REAUTH branches verified via a temporary oauth_tokens row

**Tooling:** new `apps/worker/scripts/seed-oauth-fixture.mjs` —
`seed | reauth | fresh | status | remove` against the Neon HTTP API (same
`family: 4` workaround as db-push.mjs). The fixture row holds **no token**
(`access_token_encrypted IS NULL`), and `seed`/`remove` refuse to touch any
google row that has one, so a real connection can never be clobbered by a
fixture run. The row was removed after the test; `status` confirms none
remains.

**Result — all three Google states behave as [docs/API.md](docs/API.md) documents:**

| State | `sync/status` | readers | mutators + calendar |
|---|---|---|---|
| no row | 200 `connected:false` | 503 `NEEDS_CONNECTION` | 503 `NEEDS_CONNECTION` |
| fixture, `needs_reauth=false` | 200 `connected:true` | 200 empty list · 404 unknown id | 501 `NOT_IMPLEMENTED` |
| fixture, `needs_reauth=true` | 200 `connected:true, needs_reauth:true` | 503 `NEEDS_REAUTH` | 503 `NEEDS_REAUTH` |

Extras learned: with a connection present, `GET /emails/not-a-uuid` answers
`400 INVALID_ARGS` (fixed for the disconnected state too in a later entry);
`/calendar/events` still 400s on a missing range in every state; `/emails`
returns `{messages:[], next_cursor:null}` — exactly the empty-inbox shape the
UI renders for a connected-but-empty mailbox.

**Every route and every branch of the Phase 2 REST surface is now verified by
live request.** Nothing left to prove on this surface until the Google calls
themselves are built (final phase) — beyond this point verification needs
`wrangler deploy` and real Google data.

**Next:** unchanged — the Settings-panel key entry (1.9) is what unblocks real
completions.

### 2026-09-28 — `INVALID_ARGS` now precedes the Google gate on `/emails/:id`

**Done:** all five `/emails/:id` routes (`get`, `thread`, `read`, `archive`,
`label`) validate the id **before** `assertGoogle()`, so a malformed id answers
`400 INVALID_ARGS` whether or not Google is connected, instead of hiding behind
`503 NEEDS_CONNECTION` while disconnected. A comment in `routes.ts` records the
rule: argument validity is a client bug and is reported first.

**Verified live in both states** (fixture script): bad id → 400 on
`/emails/:id`, `/emails/:id/thread`, `/emails/:id/read`, `/emails/:id/label`;
well-formed id → 503 disconnected, 404 (unknown reader) or 501 (mutator)
connected — no regression on the gated branches. Calendar precedence was
already correct (range check before the gate) and is unchanged. Fixture row
removed afterwards; `tsc --noEmit` clean.

**Next:** unchanged — the Settings-panel key entry (1.9) is what unblocks real
completions.

---

## Non-negotiable design invariants

Violating any of these breaks the product in a way that is **hard to notice**,
which is exactly why they are written down:

1. **An idle tick performs zero Postgres queries.** Otherwise Neon never
   suspends, burns its 100 CU-hour allowance mid-month, and the agent goes dark.
2. **All heavy work runs inside a Durable Object.** Now empirically confirmed
   viable on Free.
3. **Read-after-write goes through `DB_FRESH`.** Hyperdrive caches reads for 60 s
   and does not invalidate on write.
4. **Email bodies live in D1, never Postgres.** The schema enforces this.
5. **Email and web content is data, never instructions.**
6. **Skills cannot exceed their `allowed_tools` scope.**
7. **Postgres is the source of truth for artifacts.** The sandboxed iframe is a
   projection, never a store.

---

*Related: [PLAN.md](docs/PLAN.md) · [ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
[AI-SKILLS.md](docs/AI-SKILLS.md) · [PLUGINS.md](docs/PLUGINS.md)*
