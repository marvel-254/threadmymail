# ThreadMyMail - Plan & Roadmap

> **Status:** Authoritative. **Last updated:** 2026-09-27
> Supersedes the original planning document. For the decision log, see §9.

---

## 1. Product

A personal assistant that acts on your behalf. It reads your mail, manages your
calendar, keeps your to-do list, remembers what matters, and does all of it
without waiting to be asked — then tells you what it did.

**Not** an email client with AI features. The difference is structural: features
here are capabilities the agent *has*, not pages you navigate to. See
[AI-SKILLS.md](./AI-SKILLS.md).

---

## 2. Locked Decisions

| Area | Decision | Rationale |
|---|---|---|
| **Compute** | Cloudflare Workers + Durable Objects | Durable, hibernating, zero idle cost. Render spins down; Vercel Hobby cron is daily-only. |
| **Tier** | Free, pending the DO CPU spike | Workers Free costs $0. Workers Paid ($5) is the trivial escape hatch. |
| **Long jobs** | Cloudflare Workflows | `step.sleep`, `waitForEvent`, survives eviction. |
| **Scheduler** | Cron Triggers, 5-min heartbeat | 5 free per account. |
| **Database** | Neon (Postgres + pgvector) | Free, no expiry, pgvector. Render's `htmg-db` is deleted ~30 days after creation. |
| **Pooling** | Hyperdrive, two configs | Cached for search, cache-disabled for read-after-write. |
| **Blobs** | D1 (`BODIES`) | No card required (R2 needs one), native binding. Keeps bodies out of the DB and out of CPU-metered invocations. |
| **Frontend** | Cloudflare Pages | Existing Vite app, no rewrite. |
| **Language** | TypeScript (was Python) | The backend was placeholder-only; nothing lost. Agents SDK is TS-native. |
| **Email** | Gmail API (was IMAP) | IMAP needs long-lived TCP, which Workers cannot do. |
| **Calendar** | Google Calendar API | Shares the Gmail OAuth connection. |
| **Auth** | Single Google sign-in | One consent = identity + mail + calendar. |
| **Model** | OpenRouter, one primary + cheap background | One voice, one memory. |
| **Autonomy** | Fully autonomous, structural guardrails | Approval prompts are not autonomy. |
| **Plugins** | Built-ins + git URL, reviewed before install | Extensibility without redeploys. |
| **Cost** | $0/mo infrastructure | |

---

## 3. Phases

Each phase ends with a **verifiable outcome**, not a percentage.

### Phase 0 — Foundation & the spike ✅ PASSED (2026-09-27)

The spike gated the entire architecture (ARCHITECTURE §11). **Result: the Durable
Object CPU budget on the Free plan is far above the 10 ms Workers cap.** A DO
completed 40,000,000 CPU iterations with 400/400 chunks checkpointed to storage.
Both cron triggers fire. The architecture is viable on Cloudflare Free.

| # | Task | Status |
|---|---|---|
| 0.1 | Cloudflare account + Worker project | ✅ `threadmymail-worker.twistedoliver211fs.workers.dev` |
| 0.2 | **Spike:** DO agent step, measure CPU on Free | ✅ **PASSED** |
| 0.3 | Gate decision | ✅ Proceed on Cloudflare Free |
| 0.4 | Neon project + extensions | ✅ `threadmymail` @ eu-central-1, PG 17.11, vector 0.8.0 |
| 0.5 | Schema applied | ✅ 14 tables, 36 indexes, ivfflat vectors |
| 0.6 | DO migration registered | ✅ `new_sqlite_classes: ["AgentObject"]` |
| 0.7 | Body storage (D1 `BODIES`) | ✅ created; 2.5 MB object round-trips byte-for-byte |
| 0.8 | Hyperdrive `DB` / `DB_FRESH` | ❌ not created |
| 0.9 | Secrets (Google, OpenRouter, keys) | ❌ not set |
| 0.10 | Frontend agent shell | ✅ built at `/app` |

**Lesson recorded:** `Date.now()` / `performance.now()` have no resolution inside
a DO in production. A 3.4 s probe reported `elapsed_ms: 0` and produced a **false
negative verdict**. Use completion, not duration, as the signal.

### Phase 1 — The agent exists

Tool registry · persona + customization layers · `agent_runs` / `tool_calls` ·
streaming WebSocket chat · tool loop with step cap.

**Done when:** you can talk to it and watch it call tools live.

### Phase 2 — It sees and acts

Gmail OAuth + sync (cursor in the DO, bodies to D1) · `todo.*` tools ·
`todos` table · artifact iframe + binding bridge.

**Done when:** it reads your mail, and ticking a checkbox in its panel is a real
write that the agent immediately knows about.

### Phase 3 — It has a clock

Cron heartbeat · skill engine (all three trigger types) · seed skills ·
`morning_briefing` + `triage_inbox`.

**Done when:** it does something useful before you open the app.

### Phase 4 — It's genuinely autonomous

Workflows for durable runs · `waitForEvent` triggers · autonomy budgets ·
kill switch · undo stack · activity feed · action digest · dry-run mode.

**Done when:** the kill switch stops everything mid-run, and undo reverses a sent
email.

### Phase 5 — Calendar

`freebusy` · `find_meeting_time` · booking · event tagging · watch ·
`meeting_prep`.

**Done when:** "find 30 minutes with Dana and Alex next week" returns real
availability and books it.

### Phase 6 — Memory

Subagents (`delegate`, depth ≤ 2) · `memories` + pgvector · profile
maintenance · `contacts`.

**Done when:** it recalls a commitment from months ago and tells you about it
unprompted.

### Phase 7 — Extensibility

Plugin loader · manifest + permission review · git-URL install pinned by SHA ·
built-ins `notion`, `exa`, `firecrawl`, `webhooks` · plugin management UI.

**Done when:** you install a plugin, see its permission request, approve it, and
the agent uses its tools.

### Phase 8 — Mobile

Expo app · Web Push (PWA) and Expo Push (APK) · EAS build.

**Done when:** a push notification arrives on the phone and tapping it opens the
right thread.

---

## 4. What is deliberately deferred

| Deferred | Why | Revisit when |
|---|---|---|
| Generic IMAP/SMTP providers | No long-lived TCP in Workers | A provider plugin, if needed |
| Gmail push (`users.watch`) | Needs Pub/Sub + a pull subscriber | Sub-5-minute sync becomes necessary |
| Attachment search | Indexing bodies is expensive | Only if asked for |
| Public signups | Single-user by design | Never, probably |
| Agent-authored custom UI (`kind: "ui"`) | The binding protocol may suffice | See PLUGINS §8 |
| Multi-user isolation | Not needed for one user | If ever shared |
| Cross-region DB | One user, one region | — |
| Retroactive UI-panel editing of artifacts | The agent owns artifacts | If friction appears |

---

## 5. Critical Paths & Traps

Each of these is a way this project fails quietly if not designed for.

| Trap | Mitigation |
|---|---|
| **DO CPU limit on Free is 10 ms, not 30 s** | Phase 0 spike gates everything |
| **5-min heartbeat keeps Neon awake** → burns 100 CU-hours → compute suspends | Tick state in the DO; **an idle tick performs zero Postgres queries** |
| **Hyperdrive serves 60 s-stale reads** and does not invalidate on write | Dual config: `DB` cached, `DB_FRESH` for read-after-write |
| **Neon 0.5 GB storage** fills with email bodies | Bodies in D1; Neon holds small rows only |
| **Prompt injection via email** | Content as data, never instructions; per-skill tool scopes; `new_contact_policy` |
| **Autonomy compounding errors** | Dry-run on new skills, budgets, undo, daily digest |
| **Runaway subagent cost** | Depth ≤ 2, bounded concurrency (6 outgoing connections), inherited budget |
| **Cloudflare auth token expires** mid-workflow | Use `CLOUDFLARE_API_TOKEN` (non-expiring short term), not OAuth login |
| **`htmg-db` deleted ~2026-10-23** | Nothing real in it; Neon is the target |
| **Refresh token invalidation** | Scope manifest + phased consent + no retry loop on `invalid_grant` |

---

## 6. Cost Model

| Service | Free allowance | Expected use |
|---|---|---|
| Workers | 100k req/day, 10 ms CPU | <2% requests |
| Durable Objects | 100k req/day, 5 GB SQLite | Comfortable |
| Workflows | 3,000 steps/day | Fraction |
| Cron Triggers | 5/account | 2–3 |
| D1 (bodies) | 500 MB/DB, 100k writes/day, 5M reads/day | ~2.5k writes/day, ~200 reads/day |
| Neon | 100 CU-hr, 0.5 GB | ~0 (stays asleep) |
| Hyperdrive | 100k queries/day | Fraction |
| Pages | Free | Static |
| **Total** | | **$0/mo** |

**Escape hatch:** Workers Paid ($5/mo) raises the CPU cap to 5 minutes and removes
the §5 CPU risk entirely, with no code change. This is strongly preferred over
migrating to Cloud Run, and strongly preferred over paying for a database that
should be asleep anyway.

**Real variable cost:** OpenRouter (BYOK) and, in month 2+, possibly Workers Paid.

---

## 7. Repository Layout

```
apps/worker/    Cloudflare Worker: API, agent, cron, workflows, plugins
apps/web/       React + Vite + Tailwind → Cloudflare Pages
apps/mobile/    Expo → EAS APK
packages/shared/  tool schemas, types, default persona
plugins/        user-installed (git-cloned, gitignored)
docs/
```

Legacy `backend/` (Python/FastAPI) is **superseded** — see §8.

---

## 8. Legacy Material

| Path | Status |
|---|---|
| `backend/*.py` | Superseded. Placeholder routers; in-progress scaffolding of the abandoned FastAPI approach. Not part of the build. |
| `backend/requirements.txt` | Superseded |
| `hosting/RENDER.md` | Deprecated — Render is no longer the target |
| `docs/PLANNING.md` | Superseded by this document |
| `.github/workflows/ci-cd.yml` | Python pipeline — must be replaced with a TypeScript pipeline |
| `mobile/APK.md` | Still valid (EAS builds are unaffected by the hosting move) |

---

## 9. Decision Log

### 2026-09-27

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Hosting | Cloudflare | Render | Free tier spins down; kills the scheduler |
| Hosting | Cloudflare | Vercel | Hobby cron is daily-only; sub-daily expressions fail to deploy |
| Compute tier | Free, pending spike | Workers Paid ($5) | $0 is achievable if DOs get their documented CPU allowance |
| Fallback | Cloud Run | — | No per-invocation CPU cap. **Requires a billing card — do not set up pre-emptively** |
| Database | Neon | Render `htmg-db` | Free tier DBs are deleted ~30 days after creation |
| Database | Neon | D1 | SQLite; no pgvector |
| Email protocol | Gmail API | IMAP | Workers cannot hold long-lived TCP connections |
| Auth | Single Google consent | Magic links | One interaction, one connection, no passwords |
| Model routing | Primary + cheap background | One model only | Heartbeats would otherwise burn frontier-model cost for nothing |
| Autonomy | Fully autonomous, no approvals | Approval prompts | A prompt-per-action system is not autonomous, and humans rubber-stamp |
| External contacts | Configurable, default `ask` | Hard block | Flexibility without a footgun |
| Plugins | Built-in + git URL, reviewed | Public registry | Single user; registry is ceremony |
| Storage split | D1 blobs + Neon rows | R2 / Turso / all in Postgres | D1 fixes the 0.5 GB cap, reduces CPU, keeps Neon asleep, and needs no card |

### 2026-09-28

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| OpenRouter key delivery | **In-app Settings panel (per-user BYOK, encrypted in `plugin_credentials`)** | `wrangler secret put OPENROUTER_API_KEY` | The product is BYOK by design; a Worker-level secret would make every user share one key and would hide billing from the user. The key-entry UI is a product feature, not ops. |
| Google OAuth timing | **Last item of the final phase** | Building auth in Phase 1/2 | User decision. `DEV_USER_ID` stands in until then; all early work must be user-scoped so swapping it later is a one-line change. |

### 2026-09-27 — audit findings

- Wrangler auth token **expired**; `agent.md`'s claim of an active OAuth token is
  stale. Use `CLOUDFLARE_API_TOKEN`.
- `htmg-db` expires **2026-10-09**, deleted after a 14-day grace period.
- GitHub secrets present: `DATABASE_URL`, `OPENROUTER_API_KEY`. `SLACK_WEBHOOK_URL`
  (claimed in old docs) is **not** set.
- `neonctl` and `psql` are not installed locally.

---

## 10. Immediate Next Actions

1. ~~Create Hyperdrive configs `DB` / `DB_FRESH`~~ — bound in
   `wrangler.jsonc`; verify both resolve (`SELECT 1` each) — audit item
2. ~~Phase 1 agent runtime~~ — **done** (deployed v0.2.0, typechecks clean)
3. **Phase 2** — `email.*` / `calendar.*` tool stubs, `/emails` +
   `/cal/events` routes (metadata only), artifact binding verbs
4. Settings-panel **OpenRouter key entry** UI (unblocks real completions;
   replaces the not-a-blocker Worker secret)
5. Replace the Python CI workflow with a TypeScript one
6. Decide what to do with the superseded `backend/` Python scaffolding

**Do not schedule:** `wrangler secret put OPENROUTER_API_KEY` (superseded by
the in-app key) · Google OAuth (final phase, last item).

---

## 11. Measured Facts (2026-09-27)

Recorded so they are not re-derived:

| Fact | Value |
|---|---|
| DO CPU budget on Free | ≫ 10 ms. 40,000,000 iterations completed (400/400 checkpoints) |
| CPU cost per loop iteration (workerd) | ~800 ns |
| 10 ms of CPU ≈ | 12,500 iterations |
| 30 s of CPU ≈ | 37,500,000 iterations |
| `Date.now()` / `performance.now()` in a DO (production) | **No usable resolution.** Returns 0 deltas |
| Cron trigger wall time (incl. DO cold start) | ~490 ms |
| Neon `vector` | 0.8.0, `ivfflat` cosine ops |
| D1 max value size | **2 MB** → chunked at 1 MB; 2.5 MB round-trips byte-for-byte |
| D1 per-DB storage (Free) | **500 MB** (not 5 GB — that is the account total) |
| D1 queries per Worker invocation | 50 → body writes are batched |
| Schema | 14 tables, 36 indexes |
| `gen_random_uuid()` | Native in PG 17 — no `uuid-ossp` needed |
| Node `fetch` on this machine | Fails IPv6, no IPv4 fallback. Use `node:https` `family: 4` |
| Neon HTTP SQL interface | Rejects multi-statement prepared statements — one at a time |

---

*Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [AI-SKILLS.md](./AI-SKILLS.md) ·
[PLUGINS.md](./PLUGINS.md) · [API.md](./API.md) · [GOOGLE_OAUTH.md](./GOOGLE_OAUTH.md)*
