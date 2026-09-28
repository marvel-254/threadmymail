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
| Tool registry (17 tools) | ✅ Verified live in production |
| REST API (todos/memory/settings/skills) | ✅ Verified live against real Neon via Hyperdrive |
| OpenRouter model client | ✅ Written (streaming + tool calls). Untested — no API key in the Worker |
| **Body storage (D1)** | ✅ Created; 2.5 MB chunked object round-trips byte-for-byte |
| **Neon database** | ✅ Provisioned, schema applied |
| **Worker + Durable Object** | ✅ Deployed (spike build) |
| Frontend agent shell | ✅ Built — `/app` route |
| Frontend landing page | ✅ Preserved at `/` |
| Skills / calendar / plugin code | ❌ Not started (Phase 1+) |
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

### Design

- Reframed the product: an AI assistant that owns mail/calendar/tasks
- Settled hosting on Cloudflare; rejected Render (spin-down) and Vercel (daily-only cron)
- Replaced IMAP with the Gmail API; magic links with a single Google consent
- Designed the tool registry, skill system, subagents, memory, and autonomy guardrails
- Designed the artifact/binding protocol and the plugin manifest + permission model
- Settled on **$0/month** infrastructure, with a $5 Workers Paid escape hatch

---

## ⏳ Next: Phase 1 — The agent exists

| # | Task | Done when |
|---|---|---|
| 1.1 | Wire Hyperdrive (`DB` cached + `DB_FRESH` cache-disabled) to Neon | Both bindings resolve |
| ~~1.2~~ | ~~R2 buckets~~ | ✅ **Replaced by D1 — no card needed** |
| 1.3 | Drizzle client + migration runner | Migrations run from CI |
| 1.4 | Tool registry (`email.*`, `todo.*`, `memory.*`, `meta`) | Tools register and list |
| 1.5 | Agent loop on the DO: persona, stream, step cap, tool execution | Agent can run a turn |
| 1.6 | `agent_runs` / `tool_calls` persistence | Every run is logged |
| 1.7 | WebSocket `/v1/agent/stream` | Frontend connects live |
| 1.8 | Secrets: Google OAuth, OpenRouter, `ENCRYPTION_KEY`, `SESSION_SECRET` | Secrets set |

### Decisions locked (2026-09-28, by user)

1. **The OpenRouter key is entered by the user in the app's own Settings
   panel — NOT `wrangler secret put`.** It is a per-user BYOK key stored
   encrypted in `plugin_credentials` (see `agent/config.ts` header and
   [ARCHITECTURE.md §12](docs/ARCHITECTURE.md)). The Worker env var
   `OPENROUTER_API_KEY` is therefore **not** a blocker and should not be set;
   `has_model_key: false` on `/health` is expected until the in-app key is
   saved.
2. **Google OAuth is the LAST item of the FINAL phase.** Auth endpoints
   (`/auth/google`, callback, session) are deferred to the end of the
   roadmap — until then `DEV_USER_ID` in `routes.ts` is the deliberate
   stand-in. Do not build auth early.

### Still needed from the user

- ✅ **No card needed.** R2 was replaced with D1, which has no payment-method
  requirement.
- 🔴 **In-app Settings panel key entry** — the UI path for pasting the
  OpenRouter key (until it exists, the agent cannot generate completions).
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

---

## ⚠️ Environment gotchas (learned the hard way)

| Issue | Impact | Action |
|---|---|---|
| **`Date.now()` and `performance.now()` have no resolution inside a DO in production** | A 3.4 s probe reported `elapsed_ms: 0`, producing a **false negative verdict** | Use completion as the signal; read `/spike/progress` for checkpoints. Never trust duration. |
| **Node `fetch` fails IPv6 on this machine** | `ENETUNREACH`, no fallback to IPv4. curl falls back; undici does not | Use `node:https` with `family: 4` — see `apps/worker/scripts/db-push.mjs` |
| Network to Cloudflare and Neon is intermittent | `fetch failed` on deploys | Retry with a long timeout; it usually succeeds on attempt 2 |
| `wrangler whoami` takes 60–90 s (was 8 s for the user) | A 30 s timeout is a guaranteed false negative | Use ≥90 s, or just read the deploy output |
| An `ai` binding breaks `wrangler dev` non-interactively | It opens a remote proxy session and deadlocks | No `ai` binding — model access is BYOK via OpenRouter |
| `wrangler.jsonc` needs a `migrations` entry for a new DO class | Deploy fails with `code: 10061` | `new_sqlite_classes: ["AgentObject"]` |
| `@cloudflare/workers-types` must be **v5** for wrangler 4.142 | `npm install` ERESOLVE failure | Keep both on the same major |
| npm 12 blocks postinstall scripts by default | esbuild/workerd silently unusable | `npm install-scripts approve esbuild workerd` |
| CI still runs a Python pipeline | Will fail now `backend/` is dead | Replace with a TypeScript pipeline |

### Uncommitted work still in the tree

- `backend/` — Python FastAPI scaffolding, **superseded**. Not deleted; awaiting
  your decision.
- `--output` — a stray PNG from a mistyped command.
- `landing-preview.png`, `logo-preview.png` — stray artifacts.

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
