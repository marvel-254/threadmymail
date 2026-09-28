# ThreadMyMail — Your AI Assistant

> Not an email client with AI features. An assistant that acts on your behalf —
> then tells you what it did.

---

## What it is

You bring your own model key. It connects to your mail and calendar, keeps your
to-do list, remembers what matters, and **does things without waiting to be
asked**.

The agent is the product. Email, calendar, and tasks aren't pages you navigate
to — they're capabilities the agent has, and it surfaces them into a conversation
when they're relevant.

**Tone:** warm, quick, a little sassy. Never corporate, never sycophantic.

---

## How it works

- **Autonomous by default.** It triages, drafts, books, and reminds on a schedule
  and reports back afterward. No "approve this action" dialogs.
- **But bounded.** Kill switch, daily budgets, an undo stack for anything
  reversible, a plain-language activity feed, and a morning digest of everything
  it did.
- **Extensible.** Write skills in plain language ("every Friday, tell me what I
  promised and whether I did it"). Install plugins from a git URL.
- **Trusts nothing from the outside.** Email and web content is treated as data,
  never as instructions — and attempts to redirect the agent get reported, not
  obeyed.

### The to-do list

The agent writes the UI in HTML; you interact with it. Tick a checkbox → it's a
real database write *and* the agent immediately knows. Because the email from
your boss said it was due EOD, it can then offer: *"Want me to reply and confirm
that's handled?"*

That's the whole design: the to-do list is a channel between you and the agent,
not a table with a GUI.

---

## Tech

| Layer | Choice |
|---|---|
| Compute | Cloudflare Workers + **Durable Objects** (hibernating, zero idle cost) |
| Long jobs | Cloudflare **Workflows** |
| Scheduler | Cron Triggers, 5-min heartbeat |
| Database | **Neon** (Postgres + pgvector), pooled by Hyperdrive |
| Blobs | **Cloudflare D1** (email bodies, attachments, fetch cache) — no card required |
| Frontend | React + Vite + Tailwind → Cloudflare Pages (PWA) |
| Mobile | Expo → Android APK |
| Model | OpenRouter (BYOK) — one primary + a cheap background model for ticks |

**Cost: $0/month** for infrastructure, at personal-use volume. Escape hatch if
needed: Workers Paid ($5/mo) removes the CPU constraint with no code change.

---

## Docs

| Document | What's in it |
|---|---|
| **[PLAN.md](docs/PLAN.md)** | Product, locked decisions, roadmap, cost model, decision log |
| **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** | How it runs on Cloudflare, storage topology, data model |
| **[AI-SKILLS.md](docs/AI-SKILLS.md)** | Persona, tools, skills, autonomy, memory, artifacts |
| **[PLUGINS.md](docs/PLUGINS.md)** | Plugin manifest, install flow, permissions, built-ins |
| **[API.md](docs/API.md)** | REST + WebSocket surface |
| **[GOOGLE_OAUTH.md](docs/GOOGLE_OAUTH.md)** | Single-consent Google sign-in |
| [agent.md](agent.md) | Conventions for AI agents working in this repo |

> ⚠️ **Before building anything:** run the Phase 0 spike in
> [ARCHITECTURE.md §11](docs/ARCHITECTURE.md). It determines whether the whole
> architecture is viable on the free tier, and Cloudflare's own documentation is
> ambiguous on the point.

---

## Status

Planning is complete and current. Implementation has not started — the Python
backend in `backend/` is superseded scaffolding, not part of the build.

Next: the Phase 0 spike, then the agent runtime.

---

## Layout

```
apps/worker/       Cloudflare Worker — API, agent, cron, workflows, plugins
apps/web/          React + Vite + Tailwind → Cloudflare Pages
apps/mobile/       Expo → EAS APK
packages/shared/   Tool schemas, types, default persona
plugins/           User-installed (git-cloned, gitignored)
docs/
```
