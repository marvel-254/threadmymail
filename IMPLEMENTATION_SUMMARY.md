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
| **REST API (email/calendar)** | ✅ Implemented — reads work, Gmail-backed actions answer 503/501 honestly |
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
| 1.9 | **Settings-panel OpenRouter key entry** (per-user, encrypted) | A saved key makes the agent complete a turn |
| ~~1.10~~ | ~~Google OAuth client + secret~~ | ❌ **Deferred to the last item of the final phase** |

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
