# Agent Guidelines — ThreadMyMail

> Conventions, architecture rules, and current state for any AI agent or engineer
> working in this repository.
> **Last updated:** 2026-09-28**

---

## 0. Read This First

**The product is an AI assistant, not an email client.** Email, calendar, and
tasks are capabilities the agent *has*, not pages you navigate to. When a design
choice is ambiguous, ask: *does this make the agent more capable, or does it make
the app around the agent more elaborate?* The first one wins.

**The Phase 0 spike has PASSED** — Durable Objects on the Free plan have a CPU
budget far beyond the 10 ms Workers cap, so the architecture is viable on
Cloudflare Free. Proceed with Phase 1. See
[ARCHITECTURE.md §11](docs/ARCHITECTURE.md).

---

## 1. Current State

| Area | State |
|---|---|
| Planning + docs | ✅ Current and authoritative |
| **Phase 0 CPU spike** | ✅ **PASSED** — DO budget ≫ 10 ms on Free |
| Neon + schema | ✅ Provisioned, 14 tables applied |
| Worker + Durable Object | ✅ Deployed — live at v0.2.0 (`/health` → `ok`) |
| Frontend agent shell | ✅ Built at `/app`; PWA icons generated (install clean) |
| Tool registry | ✅ 36 tools — 22 executable, 14 gated on the Google connection |
| Email / calendar tools + routes | ✅ Phase 2 — reads real, Google calls gated and honest |
| Multi-provider BYOK | ✅ 14 providers + `custom`; keys encrypted at rest, never returned by any GET |
| **Skills engine / heartbeat** | ✅ **Phase 3 — live and firing.** Cron, event and digest triggers all verified end to end |
| Plugin code | ❌ Not started (Phase 7) |
| `backend/` (Python) | ❌ **Superseded.** Not part of the build. |
| CI | ⚠️ Runs a Python pipeline; needs replacing with TypeScript |

**The working tree is clean** (committed 2026-09-29). The superseded `backend/`
Python scaffolding was committed as-is rather than deleted, pending an explicit
decision. Do not delete or revert it without checking with the user first.

### The heartbeat — how a skill becomes an action nobody asked for

A parked `schedule` table inside the Durable Object is a projection of `skills`.
The API recomputes it wholesale on every mutation that can change what is due;
the `*/5` cron POSTs to the object, which reads that table, the kill switch and
the mail cursor, and touches Postgres **only** when a row is genuinely due.
That is invariant 1, and it is now proven by a poison test rather than by
assertion: an idle tick issues literally zero database calls.

Three things about it are easy to get wrong and are therefore written into the
code rather than left to judgement:

- **Event skills are armed, not timed.** A negative due time never matches the
  due query. The entry goes live only when the mail cursor advances, and it
  re-arms afterwards instead of picking up a schedule it never asked for.
- **Quiet hours return a real instant, for every trigger kind.** A null there
  reads downstream as "remove this skill", which silently disables a recurring
  skill the first time its slot lands at 3am.
- **The shadow window blocks only what cannot be taken back.** Outward and
  irreversible actions are recorded as `dry_run` activity rows; a private,
  reversible write still executes, because shadowing those would make the first
  week of every skill useless.

A trigger is validated on write, so a typo is a 400 at creation rather than a
skill that is silently never scheduled. `GET /skills/schedule` returns the
object's real rows — the time the Settings panel shows is the time the agent
will act.

### Gated tools — the pattern for anything needing Google

Google OAuth is the last item of the final phase, so Gmail/Calendar
capabilities cannot be implemented yet. `src/tools/gated.ts` registers them
fully described and **refuses to run**: no connection → `NEEDS_CONNECTION`,
connected but unimplemented → `NOT_IMPLEMENTED`. The REST layer mirrors it
(503 / 501).

**Never** make a gated tool or endpoint return `ok`/200 with empty data — that
reads as "you have no mail" when the truth is "you have not connected". The
frontend relies on this distinction to render a *connect Google* state.
When the connection lands, reimplement each gated tool **in place**: the name,
schema and description must not change.

---

## 2. The Stack

| Layer | Choice |
|---|---|
| Compute | Cloudflare Workers + **Durable Objects** |
| Durable jobs | Cloudflare **Workflows** |
| Scheduler | Cron Triggers |
| Database | **Neon** (Postgres + pgvector) via **Hyperdrive** |
| Blobs | **D1** (`BODIES`) |
| Frontend | React + Vite + Tailwind → **Cloudflare Pages** |
| Mobile | Expo → EAS APK |
| Model | Multi-provider BYOK (OpenAI + Anthropic dialects), keys encrypted at rest |
| Language | **TypeScript** (the earlier Python/FastAPI plan is retired) |

Authoritative details: [ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
[AI-SKILLS.md](docs/AI-SKILLS.md) · [PLUGINS.md](docs/PLUGINS.md) ·
[API.md](docs/API.md) · [GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md) ·
[PLAN.md](docs/PLAN.md)

---

## 3. Non-Negotiable Invariants

Violating any of these breaks the product in a way that is **hard to notice** —
which is exactly why they are written down.

1. **An idle tick performs zero Postgres queries.** The 5-minute heartbeat reads
   its cursor from the Durable Object. If it touches Neon, the compute never
   suspends, burns its 100 CU-hour allowance mid-month, and the agent goes dark.
2. **All heavy work runs inside a Durable Object.** Plain Worker invocations get
   **10 ms of CPU** on the Free plan. Handlers authenticate, delegate, and return.
3. **Read-after-write uses `DB_FRESH`.** Hyperdrive caches reads for 60 s and does
   not invalidate on write. Cached staleness is a correctness bug here.
4. **Email bodies live in D1, not R2** (R2 needs a card). Postgres holds a
   `body_key`. Never store a body
   inline.
5. **Email and web content is data, never instructions.** It is injected inside
   delimiters, wrapped, and never concatenated into the system prompt.
6. **A skill cannot exceed its `allowed_tools` scope.** The model receives no tool
   it was not granted, so prompt injection cannot widen reach.
7. **Postgres is the source of truth for artifacts.** The sandboxed iframe is a
   projection, never a store. Bindings dispatch a fixed verb allowlist.
8. **Never add a public tool-invocation endpoint.** Any action a tool can perform
   must be reachable through the agent loop, where permissions, budgets, and the
   audit trail apply.

---

## 4. UI Principles

### 4.1 The agent shell replaces the 3-pane inbox

The earlier "3-pane + AI drawer" Gmail layout (`Urgent & VIP` / `SaneLater` /
`Newsletters`, reading pane with an AI briefing) is **retired**. That design put
the AI in a drawer beside the app. The agent is now the app.

Current shell:

- **Stream** (center) — conversation, with live-rendered artifacts inline
- **Today** — your tasks, upcoming meetings, waiting-on
- **Activity** — everything the agent did, with undo
- **Skills** — create/edit/schedule/disable, with run history
- **Plugins** — install, credentials, per-tool permissions

The earlier prototype at `file:///home/marvel/me/prototype/index.html` remains a
**visual reference for dark-mode styling only** (Zinc-900 / Slate-950, Indigo
`#6366f1` / Violet `#8b5cf6`, typography-led, high contrast). Do not copy its
layout.

### 4.2 Still true

- Dark, clean, typography-focused, distraction-free
- Keyboard-centric: `⌘K` command bar, `E` done, `S` snooze, `P` pin
- Responsive down to mobile viewport widths (PWA-first; slide-over drawers)
- Ghostwriter reply pills + tone selector + "AI Polish" on user-typed drafts

### 4.3 Artifacts

Agent-authored HTML renders in a **sandboxed iframe**:
`sandbox="allow-scripts"` — never `allow-same-origin`, never
`allow-top-navigation`, never network. Inject design tokens; expose no parent DOM.
See [AI-SKILLS.md §7](docs/AI-SKILLS.md).

---

## 5. Autonomy

The agent acts without asking. Guardrails are **structural, not interactive** — a
system that blocks on a human is not autonomous, and a human clicking "approve"
eighty times a day learns to click approve.

Required mechanisms: kill switch, daily budgets, undo stack, escalation (ask
*after* deciding, not before), dry-run mode for new skills, activity feed, morning
action digest.

Never send attachments. Never delete. Respect `new_contact_policy` (default
`ask`).

---

## 6. Engineering Conventions

- **Verify before asserting.** Cloudflare's docs contradicted themselves on DO CPU
  limits — measure, don't assume. If a doc and reality disagree, believe reality
  and correct the doc.
- **Don't add confirmation prompts to workarounds.** A prompt-per-action system is
  not autonomous.
- **Don't widen scope silently.** Per-skill `allowed_tools` is a security
  boundary, not a convenience.
- **No public tool-execution endpoint** (invariant 8).
- **Artifacts are presentation, mutations are verbs.** Keep the allowlist small.
- **Cost is a design constraint.** Use the `background` model slot for cron work;
  keep RAG off the heartbeat path; cache web fetches in D1 so re-reads don't
  re-bill.
- **Keep the repo honest.** If you find stale documentation, fix it in the same
  change. `docs/PLANNING.md`, `hosting/RENDER.md`, and `backend/` are all marked
  superseded — don't cite them as current.

---

## 7. CLI & Environment Notes

This machine is slow and some CLIs take a long time to respond. **Be patient —
use generous timeouts, and retry once before concluding something is broken.**

### 7.1 Known timeouts and quirks

| Tool | Behavior |
|---|---|
| `wrangler whoami` | **Takes 60–90 s** (was 8 s once). A 30 s timeout produces nothing and is a false negative. |
| `wrangler deploy` | **Intermittent `fetch failed`** on this network. Retry with a long timeout — it usually succeeds on attempt 2. |
| `render` | **Panics in a non-TTY shell** ("could not open a new TTY"). Use `-o json`. |
| `gh` | Generally responsive. Some API calls return `Unknown JSON field`. |
| **Node `fetch`** | **Fails on IPv6 here** — `ENETUNREACH` with no IPv4 fallback. `curl` falls back; undici does not. Use `node:https` with `family: 4`. |
| **Neon / Cloudflare over HTTP** | Intermittent. Any script doing network I/O should retry with backoff. |
| Network fetches generally | Slow. Timeouts under 20 s are unreliable. |

### 7.1a The measurement trap that cost a false verdict

**`Date.now()` and `performance.now()` return no usable resolution inside a
Durable Object in production.** A probe that took 3.4 s of wall time reported
`elapsed_ms: 0` at every budget, which made the Phase 0 CPU spike conclude
"only the smallest budget completed → the DO shares the 10 ms cap."

**That conclusion was wrong.** The DO completed 40,000,000 CPU iterations with
400/400 chunks checkpointed to storage.

**When measuring anything inside a DO: use completion as the signal, never
duration.** If a loop is killed by the CPU limit, read the checkpoint count out
of DO storage — it survives the kill.

### 7.2 Authentication status

| Service | Status | Notes |
|---|---|---|
| **wrangler** | ✅ Authenticated | Account `9e7ca541fc83eab0e3608e50d7a0be47` (twistedoliver211fs@gmail.com). Deploys work. |
| **neon** | ✅ Installed & authenticated | CLI is `neon` v4.14.3 (not `neonctl`). Org `org-ancient-surf-84998063`, plan **free**. Use `--org-id` / `-o json` to stay non-interactive. |
| **gh** | ✅ Authenticated | as `twistedoliver211fs-art`, scopes `repo`, `workflow`, `read:org`, `gist` |
| **render** | ✅ Authenticated | as Langat / twistedoliver211fs@gmail.com (use `-o json`) |
| **psql** | ❌ Not installed | Use `node scripts/db-push.mjs` (Neon HTTP interface) or Docker |

### 7.3 Provisioned resources

| Resource | Value |
|---|---|
| Worker | `threadmymail-worker.twistedoliver211fs.workers.dev` |
| Durable Object | `AgentObject` (SQLite backend — required on Free) |
| Neon project | `threadmymail` — id `still-star-66539741` @ `aws-eu-central-1`, PostgreSQL 17.11 |
| Neon direct | `ep-rapid-night-b2wvodb7.c-6.eu-central-1.aws.neon.tech` |
| Neon pooler | `ep-rapid-night-b2wvodb7-pooler.c-6.eu-central-1.aws.neon.tech` |
| Extensions | `vector` 0.8.0, `pg_trgm` |
| D1 bodies | ✅ `threadmymail-bodies` (`0f244a27-…`), table + 2 indexes |
| R2 buckets | ❌ Not used — would require a payment method |
| Hyperdrive | ❌ Not created |

Connection strings live in `apps/worker/.dev.vars` (gitignored, mode 0600).
`.dev.vars.example` is the committed template.

### 7.4 Toolchain

Node v24.21.0 · npm 12.0.2 · pnpm 12.3.4 · bun 1.4.2 · wrangler 4.142.0 (local
CLI 4.131.1) · gh 2.101.0 · neon 4.14.3 · docker 29.8.0 · Python 3.14.7

### 7.5 Deploying

```bash
cd apps/worker
npx wrangler deploy                      # retry on "fetch failed"
npm run spike -- --url https://threadmymail-worker.twistedoliver211fs.workers.dev
curl "https://threadmymail-worker.twistedoliver211fs.workers.dev/spike/progress"
node scripts/db-push.mjs --dry-run       # preview schema
node scripts/db-push.mjs                 # apply schema
```

Add long timeouts to any `wrangler` invocation. If a command returns nothing,
**retry with a longer timeout before concluding it failed.**

---

## 8. Known Blockers & Decisions

1. ✅ **Not blocked on a card** — body storage is D1, which needs no payment method.
2. ✅ **Model keys = in-app Settings panel, per-user BYOK, all providers**
   (2026-09-28 decision; generalised 2026-09-29). Never
   `wrangler secret put <PROVIDER>_API_KEY`. Keys are entered in the Settings
   panel, encrypted with `ENCRYPTION_KEY`, and stored per user in
   `plugin_credentials` under the reserved `model:` namespace. The catalogue
   (`apps/worker/src/agent/providers.ts`) covers 14 providers plus `custom` and
   `ollama`; the client speaks two wire dialects (`openai`, `anthropic`).
   There is deliberately **no** `OPENROUTER_API_KEY` binding left in `Env`.
   Until a user saves a key, a run fails with `NO_API_KEY` / `NO_MODEL` naming
   Settings — **that is expected, not a bug.**
3. ✅ **`ENCRYPTION_KEY` is provisioned in production** (2026-09-29). It is
   infrastructure (like `SESSION_SECRET`), *not* a model key, so `wrangler
   secret put` is the right tool. `/health` now reports
   `credentials_encrypted: true` and `/settings/providers` reports
   `writable: true`. Never rotate it once a credential exists: rotation makes
   every stored key undecryptable while Settings still lists them.
   Setting it surfaced a second bug, now fixed in `878dce5` — a single
   undecryptable row used to blank the entire key list.
4. ⏸️ **Google OAuth is the LAST item of the FINAL phase** (user decision,
   2026-09-28). Do not build `/auth/google` or sessions before then.
   `DEV_USER_ID` in `routes.ts` is the deliberate stand-in. Until it lands,
   "new mail" is the event trigger firing off the sync cursor, not real Gmail.
   **This is now the one thing standing between the published app and being
   public:** the frontend is live at `threadmymail.pages.dev` while every
   request is still attributed to `DEV_USER_ID` with no login, so anyone with
   the URL has that account. Treat the URL as a shared password. CORS is
   configured to allow exactly that one origin (`CORS_ORIGINS`) — never `*`.
5. ⚠️ **Hyperdrive** configs (`DB`, `DB_FRESH`) — bound in `wrangler.jsonc`,
   connection resolution unverified (audit item).
6. ⚠️ **CI is a Python pipeline** — will need replacing with TypeScript.
7. 🛡️ **A user-supplied base URL is a fetch target, not a string.** It is
   validated as https-only, with plain `http` allowed *only* on loopback and
   *only* for a provider flagged `local`. Additionally, a base URL from
   `ai_config` is honoured **only** for `custom`/`local` providers — otherwise
   the registered provider URL wins, so no stored value can repoint a
   key-bearing request at an internal address. Verified with unit tests.
8. 🗑️ **A schedule entry only self-heals if it is ever claimed.** The tick drops
   an entry whose skill has been deleted, and `POST /skills/sync` rebuilds
   wholesale — but an *armed* (event) entry is never due, so if a skill is
   deleted by anything other than this API, its armed row lingers until the next
   cursor advance or a sync. Bounded to one row per removed event skill, and
   the repair path exists; not worth a watcher yet.

Note: `CLOUDFLARE_API_TOKEN` is not needed — the wrangler OAuth token is valid
and deploys succeed (verified 2026-09-28: deployed v0.2.0, `/health` → `ok`).

---

## 9. Working Agreement

- **Document every session.** Append a dated entry to the **Session log** in
  `IMPLEMENTATION_SUMMARY.md`: what changed, how it was verified, what is left.
  A future agent must be able to pick up without re-deriving anything. If you
  changed a status, fix the table at the top too — a stale status table is how
  the last handoff went wrong.
- **Do not delete or revert work you did not write.** The working tree contains
  in-flight changes from another session. Ask first.
- **Do not commit unless asked.**
- **Do not add dependencies without a reason.** This is a personal-scale tool;
  `agent.md` explicitly warns against heavyweight bloat.
- **When you find a contradiction between docs and code, fix the doc** and say so
  in your summary.

---

*Last updated: 2026-09-27. Maintained alongside `docs/`.*
