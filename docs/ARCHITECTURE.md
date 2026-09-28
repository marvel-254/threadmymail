# ThreadMyMail - Architecture

> **Status:** Authoritative. Supersedes the previous Render/FastAPI architecture.
> **Last updated:** 2026-09-27

---

## 1. What This Is

ThreadMyMail is **not an email client with AI features**. It is a personal
assistant that happens to read email, and it owns a calendar, a to-do list, a
notes connection, and the web. The chat/agent surface is the primary interface;
mail and calendar are *capabilities the agent has*, not pages you navigate to.

> "Act on my behalf without waiting to be asked, and tell me afterwards."

Everything below follows from that. When a design choice is ambiguous, ask: does
this make the agent more capable, or does it make the *app around* the agent
more elaborate? The first one wins.

---

## 2. Platform Decision

### 2.1 Why Cloudflare, not Render

The original plan targeted Render (FastAPI) + APScheduler. That fails the core
requirement. Render's free web service spins down after ~15 minutes of
inactivity, and an in-process scheduler dies with it. Half the value of this
product is the agent doing things *while you sleep*, so the scheduler has to be
something no one has to keep alive.

Vercel was evaluated and rejected: on the Hobby plan cron jobs may run **once
per day only**, and any more frequent expression **fails at deploy time**.

Cloudflare provides the primitives this product actually needs:

| Need | Primitive | Notes |
|---|---|---|
| Durable, long-lived agent identity | **Durable Objects** | Available on Free (SQLite backend). Hibernates at **zero compute cost**. |
| Durable multi-step jobs | **Workflows** (GA) | `step.sleep`, `waitForEvent` (up to 1 year), `waitForApproval`, 30 min/step, unlimited steps. Free: 3,000 steps/day. |
| Heartbeat | **Cron Triggers** | Free: 5 per account, 15 min wall time. |
| Chat + streaming + subagents | **Agents SDK** on a DO | `subAgent()`, `schedule()`, `runFiber()`, chat recovery after eviction. |
| Frontend | **Cloudflare Pages** | Free static hosting; the existing Vite app deploys unchanged. |
| Blob storage | **D1** | No card required, native binding, 500 MB/DB. Replaced R2 — see §4.1. |
| DB connection pooling | **Hyperdrive** | Free on Workers Paid. |
| Database | **Neon** | Postgres + pgvector, free tier, no expiry. |

Cloudflare's own documentation now describes using Workflows as "the durable
harnesses that manage and keep agents alive," with agent loops on top. That is
this product, described in their docs.

### 2.2 The compute-tier gate (IMPORTANT)

Cloudflare **Free** allows **10 ms of CPU per Worker invocation**, including Cron
Triggers. Ten milliseconds cannot run an LLM agent loop, parse an email, or
execute a pgvector search.

**Durable Objects are different.** The Durable Objects limits table specifies
**30 seconds of CPU per request by default**, configurable to 5 minutes, and DOs
are available on the Free plan (SQLite storage backend only).

That difference is the entire free-tier strategy:

> **All heavy work executes inside a Durable Object. Cron ticks and HTTP handlers
> stay thin — they authenticate, delegate, and return.**

Cloudflare's DO documentation also states that "Workers limits apply according to
your Workers plan," which conflicts with its own 30-second figure. This is
**unresolved in the docs and must be verified empirically** — see
[§11 Phase 0 Spike](#11-phase-0--the-spike-that-gates-everything).

If DOs turn out to be capped at 10 ms on Free, the fallback is Google Cloud Run
(2M requests/month, 180,000 vCPU-seconds/month, **no per-invocation CPU cap**)
plus Cloud Scheduler (3 jobs free). That fallback requires a billing account with
a card attached, which is why it is not set up pre-emptively.

### 2.3 Why the model calls are not the expensive part

Waiting on an HTTP response is **wall time, not CPU time**. Streaming 500 tokens
from OpenRouter over 20 seconds costs almost no CPU, because the isolate is idle
while the socket is open. The 10 ms budget is spent on *our* code: routing,
parsing, transforming.

This is why a thin entrypoint delegating to a DO works, and it is why offloading
blobs to D1 (§4) buys twice: it fixes storage *and* it keeps large payloads out
of CPU-metered invocations.

---

## 3. Component Map

```
┌────────────────────────────┐        ┌─────────────────────────────┐
│  Cloudflare Pages          │        │  Cloudflare Pages           │
│  apps/web                  │        │  (static assets only)       │
│  React + Vite + Tailwind   │        └─────────────────────────────┘
│  PWA shell, Web Push       │
└──────────┬─────────────────┘
           │ HTTPS / WebSocket
           ▼
┌────────────────────────────────────────────────────────────────────┐
│  apps/worker  —  Cloudflare Worker                                  │
│                                                                    │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐  │
│  │ API (Hono)   │  │ Chat Agent    │  │ Cron / Heartbeat         │  │
│  │ REST + WS    │  │ Durable Object│  │ */5, */15, 07:00 local  │  │
│  │ thin         │  │ Agents SDK    │  │ thin — delegates to DO   │  │
│  └──────┬───────┘  └───────┬───────┘  └────────────┬─────────────┘  │
│         │                  │                       │                │
│         │        ┌─────────▼───────────────────────▼──────────┐     │
│         │        │  Tool Registry (one namespace)            │     │
│         │        │  email · calendar · todo · memory ·       │     │
│         │        │  web · notes · meta                      │     │
│         │        └─────────┬─────────────────────────────────┘     │
│         │                  │                                        │
│         │        ┌─────────▼──────────┐   ┌──────────────────┐     │
│         │        │ Workflows          │   │ Plugins          │     │
│         │        │ durable skill runs │   │ loader + builtins│     │
│         │        │ sleep · waitForEvent│  │ notion/exa/etc   │     │
│         │        └────────────────────┘   └──────────────────┘     │
└─────────┼──────────────────────────────────────────────────────────┘
          │
   ┌──────┴───────┬──────────────┬────────────────┐
   ▼              ▼              ▼                ▼
┌────────┐  ┌──────────┐  ┌─────────────┐  ┌──────────────┐
│ Neon   │  │ DO SQLite│  │ D1 (bodies) │  │ Google APIs  │
│ Postgres│  │ cursors, │  │ bodies,     │  │ Gmail,       │
│ +vector│  │ sessions │  │ attachments,│  │ Calendar     │
│ (HD)   │  │ tick st. │  │ fetch cache │  │              │
└────────┘  └──────────┘  └─────────────┘  └──────────────┘
```

### 3.1 The three faces of one Worker

A single Worker script exposes three entrypoints. They share code, they have very
different CPU budgets.

| Face | Mechanism | Rule |
|---|---|---|
| **API** | Hono router, `fetch()` | No DB work in the handler beyond a single query. Delegate immediately. |
| **Chat** | Agents SDK class on a Durable Object | All agent loops run here. Full CPU allowance. |
| **Clock** | `scheduled()` handler | Read state from the DO, do a cheap external check, delegate. Never query Neon directly. |

---

## 4. Storage Topology

This split is load-bearing. It solves the Neon storage cap, keeps Neon asleep
(below), and reduces per-invocation CPU.

| Data | Home | Why there |
|---|---|---|
| Email body text + HTML, attachments | **D1** (`BODIES`) | 90%+ of the bytes. Keeps large payloads out of CPU-metered invocations and out of the 0.5 GB DB. |
| Web-fetch cache | **D1** (`BODIES`, `fx/` prefix + TTL) | Prevents re-billing Exa/Firecrawl on re-reads. |
| `users`, `todos`, `skills`, `agent_runs`, `tool_calls`, `memories`, `contacts`, `activity`, `oauth_tokens`, `plugins`, `plugin_credentials` | **Neon** | Structured, relational, queried. Small rows only. |
| `memories.embedding` | **Neon + pgvector** | 1536-dim float ≈ 6 KB/row → 0.5 GB holds ~80k vectors. |
| Gmail `historyId` cursor, tick state, hot cache, chat sessions | **DO SQLite** | 5 GB free, hibernates, and **never wakes Neon**. |

**Neon stores only a `body_key` pointer into D1, never the body itself.**

### 4.1 Why D1 and not R2

R2 is the better object store, and was the original choice. It was replaced
because **R2 requires a payment method on the Cloudflare account even on the free
tier.** D1 does not, and is a native binding — so reads cost no network hop and
no egress charge.

| | R2 Free | **D1 Free (chosen)** |
|---|---|---|
| Card required | **Yes** | **No** |
| Capacity | 10 GB | 500 MB per DB, 5 GB per account |
| Max value size | 5 TiB | **2 MB** → content is chunked at 1 MB |
| Ops budget | 1M writes/mo, 10M reads/mo | 100k writes/**day**, 5M reads/**day** |
| Access from Worker | Native binding | Native binding |
| Egress | Free | Free |
| Over-limit behaviour | Billed | **Hard block** until 00:00 UTC |

**Consequences accepted:**
- 500 MB holds roughly 25,000 typical messages at 20 KB each. Adequate for a
  personal archive with the retention sweep; would need Workers Paid for more.
- 2 MB per value forced chunking. `BodyStore` splits at 1 MB and reassembles on
  read, writing one *batched* statement set to stay inside D1's 50-queries-per-
  invocation limit. Verified in production: a 2.5 MB object round-trips
  byte-for-byte.
- Attachments are still not auto-downloaded (see §8), so the budget goes to
  bodies. On-demand attachment fetches get a short TTL.
- Hitting the daily write cap **blocks D1** rather than billing. The per-tick
  sync cap and the retention sweep keep normal usage ~3 orders of magnitude
  below the limit.

**Portability:** the rest of the codebase only ever sees keys. Swapping D1 → R2
means reimplementing `src/storage/bodystore.ts` and nothing else.

### 4.2 Why not Turso

Turso's free tier (5 GB, 500M rows read/mo, 10M rows written/mo, no card) is
genuinely more generous than D1's on paper. It was rejected for this workload:

- **It is remote, not native.** Every body read is a network hop from the Worker
  to a non-Cloudflare network. D1 and R2 are both in-process bindings.
- **It adds a platform.** The architecture is otherwise Cloudflare + Neon.
- **Its differentiators are irrelevant here.** Native vector search, FTS, CDC,
  and Turso Sync are things we do not use — vector search already lives in Neon
  via pgvector, and the sync model is a Durable Object, not libSQL sync.
- **Hard block on limit exceed**, same failure mode as D1, with a worse ceiling
  for this use case since it is 2 MB-limited per value too.

Turso would be the right answer if we were dropping Neon in favour of a
SQLite-everything stack. We are not.

---

## 5. The Neon Heartbeat Trap

Neon Free allows **100 CU-hours per project per month** and suspends compute
**5 minutes after the last query**. A 0.25 CU compute running continuously costs
~182 CU-hours/month. The budget therefore permits roughly half a month of uptime.

A naive 5-minute heartbeat never produces a 5-minute idle gap, so the compute
never suspends, bills continuously, exhausts the allowance mid-month, and
**Neon suspends compute until the billing period resets** — the agent goes dark.

**The fix is architectural, not a bigger plan.** The tick must never touch Neon:

```
Cron (*/5)
  └─► Durable Object holds { gmail_history_id, last_tick_at }
        ├─ nothing new? ──► return. Zero Neon contact. DB stays asleep.
        └─ new mail?   ──► one batched write, store bodies in D1,
                          then let the compute suspend again.
```

**Invariant: an idle tick performs zero Postgres queries.** The sync cursor lives
in DO SQLite precisely so the 5-minute heartbeat costs 0 CU-hours.

---

## 6. Hyperdrive: Two Configurations

Hyperdrive caches read queries for **60 seconds by default and does not
invalidate on write**. For an assistant whose entire job is reporting current
state, that is a correctness bug, not a performance trade.

Two configurations, bound side by side:

| Binding | Caching | Used for |
|---|---|---|
| `DB` | Enabled | Search, browse, RAG over large stable result sets. `max_age` 60s, `stale_while_revalidate` 15s. |
| `DB_FRESH` | **Disabled** (`--caching-disabled`) | Auth/session, todo state, anything read-after-write, anything immediately following a write. |

Note: Hyperdrive's pooler runs in **transaction mode**. A connection is returned
to the pool at transaction end. Do not hold long transactions open, and do not
assume `SET` state persists across pooled connections. Keep transactions short
and single-purpose.

---

## 7. Data Model

Existing `email_accounts`/`email_messages` tables are superseded. The new model
is agent-centric.

```sql
-- Identity ------------------------------------------------------------
users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub        TEXT UNIQUE,              -- Google subject claim
  email             TEXT UNIQUE NOT NULL,
  full_name         TEXT,
  persona           TEXT,                     -- editable system-prompt override
  profile           JSONB,                    -- agent-maintained, user-editable
  ai_config         JSONB,                    -- primary + background model slots
  prefs             JSONB,                    -- autonomy policy, new-contact rules
  budget_state      JSONB,                    -- daily token/spend usage
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

oauth_tokens (                        -- generic, keyed by provider + scopes
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,        -- 'google'
  scopes        TEXT[] NOT NULL,      -- so scope additions are detectable
  access_token_encrypted  TEXT,
  refresh_token_encrypted TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Agent execution -----------------------------------------------------
agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  skill_id      UUID REFERENCES skills(id) ON DELETE SET NULL,
  parent_run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE,  -- subagents
  trigger       TEXT NOT NULL,        -- 'on_demand'|'cron'|'event'|'manual'
  status        TEXT NOT NULL,        -- 'running'|'completed'|'failed'|'aborted'
  input         JSONB,
  output        JSONB,
  model         TEXT,
  tokens_in     INTEGER DEFAULT 0,
  tokens_out    INTEGER DEFAULT 0,
  cost_usd      NUMERIC(10,6) DEFAULT 0,
  error         TEXT,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

tool_calls (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool          TEXT NOT NULL,
  args          JSONB,
  result        JSONB,
  ok            BOOLEAN DEFAULT TRUE,
  latency_ms    INTEGER,
  tokens        INTEGER DEFAULT 0,
  reversible    BOOLEAN DEFAULT FALSE,
  undo_ref      TEXT,                 -- for the undo stack
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Skills & plugins ----------------------------------------------------
skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,                 -- what the model sees when choosing skills
  instructions  TEXT NOT NULL,        -- plain-language body
  allowed_tools TEXT[] NOT NULL,
  trigger       JSONB NOT NULL,       -- {type, config}
  budget        JSONB,                -- {max_runs_per_day, max_tokens}
  model_slot    TEXT DEFAULT 'inherit', -- 'primary'|'background'|'inherit'
  enabled       BOOLEAN DEFAULT TRUE,
  dry_run_until TIMESTAMPTZ,          -- shadow mode for new skills
  version       INTEGER DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

plugins (
  id            TEXT PRIMARY KEY,     -- manifest id
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  manifest      JSONB NOT NULL,
  source        TEXT,                 -- 'builtin' | git URL
  source_sha    TEXT,                 -- pinned commit
  enabled       BOOLEAN DEFAULT TRUE,
  tool_grants   JSONB,                -- per-tool permission grants
  installed_at  TIMESTAMPTZ DEFAULT NOW()
);

plugin_credentials (
  plugin_id     TEXT NOT NULL,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,
  PRIMARY KEY (plugin_id, user_id, key)
);

-- Work items ----------------------------------------------------------
todos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'open',   -- open|done|dropped
  priority        INTEGER DEFAULT 0,              -- 1..10
  due_at          TIMESTAMPTZ,
  source          TEXT,                            -- 'agent'|'user'|'email'|'notion'
  source_ref      TEXT,                            -- email id, notion page, run id
  thread_id       TEXT,                            -- back-reference to email
  calendar_event_id TEXT,
  position        INTEGER DEFAULT 0,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

artifacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,        -- 'todo_panel'|'agenda'|'table'|...
  html        TEXT NOT NULL,        -- agent-authored, sandboxed
  state       JSONB,                -- declarative state
  bindings    JSONB,                -- allowed verbs
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Memory & context ----------------------------------------------------
memories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,        -- 'fact'|'preference'|'commitment'|'person'
  content     TEXT NOT NULL,
  importance  INTEGER DEFAULT 5,    -- 1..10
  pinned      BOOLEAN DEFAULT FALSE,-- user-locked, never auto-pruned
  source_ref  TEXT,
  embedding   VECTOR(1536),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  name         TEXT,
  relation     TEXT,                -- agent's read: "manager", "friend"
  first_seen   TIMESTAMPTZ,
  last_contact TIMESTAMPTZ,
  metadata     JSONB,
  UNIQUE (user_id, email)
);

email_messages (                    -- metadata only; bodies live in D1
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  gmail_id      TEXT NOT NULL,
  thread_id     TEXT,
  subject       TEXT,
  from_address  TEXT,
  to_addresses  JSONB,
  snippet       TEXT,               -- inline; small
  body_key      TEXT,               -- D1 body-store key
  has_attachments BOOLEAN DEFAULT FALSE,
  label_ids     TEXT[],
  received_at   TIMESTAMPTZ NOT NULL,
  read_at       TIMESTAMPTZ,
  ai_summary    TEXT,
  ai_priority   INTEGER DEFAULT 0,
  embedding     VECTOR(1536),
  UNIQUE (user_id, gmail_id)
);

activity (                          -- unified, user-facing audit feed
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  run_id      UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,        -- 'email_sent'|'meeting_booked'|...
  summary     TEXT NOT NULL,
  reversible  BOOLEAN DEFAULT FALSE,
  undo_ref    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

Enabling pgvector: `CREATE EXTENSION IF NOT EXISTS vector;`

---

## 8. Gmail Sync

**Gmail API only for v1.** Generic IMAP is explicitly out of scope: it requires
long-lived TCP connections, which do not fit the Worker execution model.

| Concern | Approach |
|---|---|
| Incremental sync | `users.history.list` from the last `historyId`, stored in the DO — not Postgres. |
| Body storage | `messages.get` with `format=full`, body text → D1, metadata → Neon. Snippet stored inline. |
| Poll interval | 5 minutes (one of five free cron triggers). |
| Push | **Deferred.** `users.watch` requires a Cloud Pub/Sub topic and a pull subscriber — a whole extra component. Not worth it for 5-minute polling. |
| Send | `users.messages.send` |
| Threading | Gmail's native `threadId` |
| Refresh tokens | Serialize refresh writes to Neon; on `invalid_grant`, mark the connection `needs_reauth` and notify rather than looping. |

Attachments are **not** auto-downloaded. Metadata is recorded; the agent fetches a
specific attachment on demand (e.g. user asks "what's in the invoice PDF?").

---

## 9. Calendar

Google Calendar via the same OAuth connection as Gmail — one consent, one token.

| Tool | Backing call |
|---|---|
| `calendar.list_events` | `events.list` |
| `calendar.get_freebusy` | `freebusy.query` — the key primitive |
| `calendar.find_meeting_time` | compose `get_freebusy` across attendees, rank slots |
| `calendar.create_event` | `events.insert` (tagged `threadmymail:created`) |
| `calendar.reschedule` / `cancel` / `rsvp` | `events.patch` / `events.delete` / response |

**Watch** = poll on the 15-minute cron; diff `updated` timestamps; fire event
triggers (notably `meeting_prep` 30 minutes before start).

Events the agent creates are tagged so it can distinguish "I booked this" from
"someone booked me" — which determines whether it follows up or prepares.

---

## 10. Request Lifecycle

### 10.1 Interactive chat

```
Browser ──WS──► ChatAgent Durable Object
                   ├─ persist conversation (DO SQLite)
                   ├─ assemble context: persona + profile + skills + recent memory
                   ├─ stream completion from OpenRouter
                   ├─ tool call? ──► ToolRegistry.execute()
                   │     ├─ permission check (skill scope ∩ granted ∩ prefs)
                   │     ├─ run, log to tool_calls
                   │     └─ return observation
                   └─◄── loop until final or step cap
```

State lives in the DO, so an eviction mid-stream is recoverable via the SDK's
chat recovery. The conversation is the one thing that must survive a crash.

### 10.2 Heartbeat

```
Cron(*/5) ──► Scheduled Handler (thin)
                 └─► AssistantAgent DO: read cursor
                       ├─ Gmail history.list(cursor)      [external API, no DB]
                       ├─ new? ──► write batch to Neon, bodies → D1, set new cursor
                       └─ none ──► no-op
```

### 10.3 Scheduled skill

```
Cron(07:00) or Workflow trigger
   └─► Workflow instance (durable)
         ├─ step: load skill + assemble context
         ├─ step: delegate to agent DO
         ├─ step: perform actions (todos, email, calendar)
         ├─ step: push/notify
         └─ step: write agent_runs + activity
```

Workflows state retention is **3 days on Free / 30 days on Paid** — so the
*schedule registry* lives in Postgres and Workflows hold only individual run
instances.

---

## 11. Phase 0 - The Spike That Gates Everything

Before any feature work, empirically determine whether a Durable Object on the
**Free** plan receives the 30-second CPU allowance or the 10-millisecond one.
Documentation is ambiguous (§2.2).

### 11.1 RESULT: PASSED — run 2026-09-27

**The Durable Object CPU budget on the Free plan is far above the 10 ms Workers
Free cap.** The architecture is viable on Cloudflare Free.

| Probe | Iterations | Result |
|---|---|---|
| n=1,000 | 1,000 | completed |
| n=12,000 | 12,000 | completed (≈ the 10 ms cap) |
| n=150,000 | 150,000 | **completed — 10× the Free cap** |
| n=1,000,000 | 1,000,000 | **completed** |
| n=8,000,000 | 8,000,000 | **completed** |
| n=40,000,000 | 40,000,000 | **completed** |

Verified independently of timing: the DO checkpointed **400/400 chunks**
(400 × 100,000 = 40,000,000 iterations) into SQLite storage, which survives a
hard CPU kill. The loop therefore genuinely executed — it was not JIT-eliminated.

Both cron triggers fired in production (`*/5` and `*/15`, `ok: true`).

### 11.2 ⚠️ Measurement gotcha — do not repeat this mistake

`Date.now()` **and** `performance.now()` return no usable resolution inside a
Durable Object in production. A probe that took 3.4 s of wall time reported
`elapsed_ms: 0` at every budget.

A first run using wall-clock timing as the signal produced a **false negative
verdict** ("only the smallest budget completed → do not build"). Timing is
untrustworthy here.

**Use completion as the signal, not duration.** If a probe is killed by the CPU
limit, read `/spike/progress` — the checkpoint count reveals the real ceiling.

Local calibration (workerd, this machine): **~800 ns/iteration**, so
10 ms ≈ 12,500 iterations and 30 s ≈ 37,500,000.

### 11.3 What this unblocks

Phase 1 (agent runtime) can begin. The remaining Phase 0 items are
infrastructure, not gates: the D1 body store (done), Hyperdrive configs, and
secrets.

### 11.4 Reproducing

```bash
cd apps/worker
npx wrangler deploy
npm run spike -- --url https://threadmymail-worker.twistedoliver211fs.workers.dev
curl "$URL/spike/progress"     # checkpoint count
```

---

## 12. Security

| Risk | Mitigation |
|---|---|
| **Prompt injection from email/web** | Email and fetched content is injected as **data**, never instructions, wrapped in delimiters. Tool scopes are per-skill. `new_contact_policy` gates outward actions. Any instruction-like content is flagged and reported, not obeyed. |
| Unbounded autonomy | Hard block: never send attachments; never delete; never act on contacts with no prior thread history beyond `new_contact_policy`. |
| Secrets at rest | Fernet (or WebCrypto AES-GCM) for `oauth_tokens` and `plugin_credentials`, keyed by `ENCRYPTION_KEY`. |
| Plugin code execution | Manifest + permission review before install, commit-SHA pinned, permissions re-verified on update. Plugins are arbitrary in-process code — the review is the only gate. |
| SSRF via `web_fetch` | Deny private/loopback/link-local ranges, cap response size, enforce scheme allowlist, cache with TTL. |
| API key exposure | BYOK keys in `ENCRYPTION_KEY`-encrypted columns; never returned by any endpoint; never logged. |
| Model content logging | Off by default. `tool_calls.result` redacted for configured providers. |
| CORS | Explicit origin allowlist (not `*`) from the outset. |

---

## 13. Repository Layout

```
threadmymail/
├── apps/
│   ├── worker/                 # Cloudflare Worker: API, agent, cron, workflows
│   │   ├── src/
│   │   │   ├── index.ts        # Hono router + fetch/scheduled entrypoints
│   │   │   ├── agent/          # DO agent class, tool loop, subagents
│   │   │   ├── tools/          # registry + email/calendar/todo/memory/web/notes/meta
│   │   │   ├── workflows/      # durable skill runs
│   │   │   ├── cron/           # heartbeat handlers (thin)
│   │   │   ├── skills/         # skill engine, trigger evaluation
│   │   │   ├── plugins/        # loader, permissions, builtins
│   │   │   ├── db/             # Drizzle schema, dual Hyperdrive clients
│   │   │   └── auth/           # Google OAuth, session
│   │   ├── drizzle/            # migrations
│   │   └── wrangler.jsonc
│   ├── web/                    # React + Vite + Tailwind → Cloudflare Pages
│   └── mobile/                 # Expo → EAS APK
├── packages/
│   └── shared/                 # tool schemas, types, default persona
├── plugins/                    # user-installed (git-cloned; gitignored)
├── docs/
└── .github/workflows/ci.yml    # TypeScript pipeline
```

### 13.1 Frontend: the agent shell

The 3-pane Gmail layout is retired in favour of an agent-first shell:

- **Stream** (center) — conversation with inline live-rendered artifacts
- **Today** — your tasks, upcoming meetings, waiting-on
- **Activity** — everything the agent did, with undo
- **Skills** — create/edit/schedule/disable, with run history
- **Plugins** — install, credentials, per-tool permissions

---

## 14. Free-Tier Budget

| Resource | Free allowance | Expected use |
|---|---|---|
| Workers requests | 100,000/day | ~1,500/day (<2%) |
| Workers CPU | 10 ms/invocation | Thin handlers only |
| DO requests | 100,000/day | Comfortable |
| DO SQLite | 5 GB | Cursors, sessions, hot cache |
| Cron triggers | 5/account | 2-3 used |
| Workflows | 3,000 steps/day | Fraction |
| R2 | 10 GB-mo, 1M writes, 10M reads | Not used (card required) |
| **D1 (bodies)** | 500 MB/DB, 100k writes/day, 5M reads/day | ~2.5k writes/day, ~200 reads/day |
| Neon compute | 100 CU-hours/mo | ~0 (stays asleep — §5) |
| Neon storage | 0.5 GB | Small rows only |
| Hyperdrive | 100,000 queries/day | Fraction |
| Pages | Free | Static |

**Known constraints to design around:**
- **6 simultaneous outgoing connections per request** on both Free and Paid →
  subagent fan-out uses bounded concurrency, not true parallelism.
- **Hyperdrive origin connections:** ~20 on Paid (the 0.5 GB / 2-connection free
  allowance is not sufficient). Pool the client to `max: 5` per Cloudflare's own
  Postgres example.
- **D1 max value size is 2 MB** — content is chunked at 1 MB. Verified: a 2.5 MB
  object round-trips byte-for-byte.
- **D1 allows 50 queries per Worker invocation** — body writes are batched, not
  looped.
- **D1 over-limits hard-block** until 00:00 UTC rather than billing. The per-tick
  sync cap exists to keep clear of this.
- Workers **Free** cannot use key-value-backed DOs — SQLite only.
- Workflows storage: 1 GB free, 3-day retention.

---

## 15. Infrastructure Cost

| Service | Cost |
|---|---|
| Cloudflare Workers | $0 (Free) |
| Cloudflare Pages | $0 |
| D1 (bodies) | $0 |
| Hyperdrive | $0 |
| Neon | $0 (under 100 CU-hr + 0.5 GB) |
| **Total infrastructure** | **$0/mo** |
| OpenRouter (BYOK) | your usage |
| Expo Push | $0 |
| EAS Build | $0 (free tier) |

**Backup plan if Free proves insufficient:** Workers Paid is $5/mo and lifts the
CPU cap to 5 minutes outright, which removes the entire §2.2 constraint without
any code change. That is the cheapest possible exit from the free tier and is
preferred over moving to Cloud Run.

---

## 16. Deprecated

| Document | Status |
|---|---|
| `hosting/RENDER.md` | **Deprecated.** Render is no longer the target. Retained for history only. |
| Previous `docs/ARCHITECTURE.md` (FastAPI monolith + APScheduler) | Superseded by this document. |
| `docs/PLANNING.md` | Superseded by `docs/PLAN.md`. |
| IMAP/SMTP support | Removed from v1 scope. See §8. |
| Magic-link auth | Removed. Google OAuth is the sole sign-in. |

---

*Related: [AI-SKILLS.md](./AI-SKILLS.md) · [PLUGINS.md](./PLUGINS.md) ·
[API.md](./API.md) · [GOOGLE_OAUTH.md](./GOOGLE_OAUTH.md) · [PLAN.md](./PLAN.md)*
