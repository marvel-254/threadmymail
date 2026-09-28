# Planning Document — SUPERSEDED

> **This document is obsolete. Do not follow it.**
> Superseded on 2026-09-27.

---

## Why it was retired

This document planned an **email client with AI features**, built on **Python
FastAPI hosted on Render** with APScheduler for scheduling.

The product is now **an AI personal assistant that owns your mail, calendar,
tasks, notes, and web** — email is one capability, not the container. That
reframing invalidated most of the technical plan, and three of its premises
turned out to be unworkable:

| Old premise | Reality |
|---|---|
| Render free tier hosts the backend and scheduler | Free web services **spin down after ~15 min idle**, taking APScheduler with them. Half the product's value is the agent acting while you sleep. |
| Render Postgres `htmg-db` as the database | Free Render Postgres is **deleted ~30 days after creation** (14-day grace). This instance expires **2026-10-09**. |
| IMAP for mail sync | IMAP requires long-lived TCP connections, which Cloudflare Workers cannot hold. **Gmail API** replaces it. |
| Python/FastAPI + LiteLLM | Replaced with **TypeScript on Cloudflare Workers + Durable Objects + Workflows**, which are purpose-built for long-lived autonomous agents and hibernate at zero cost. |
| Five fixed AI endpoints (`/ai/summarize`, `/compose`, …) | Replaced by a **tool registry + user-editable skills** — the user can add capabilities, not just use the five we happened to build. |
| Magic-link auth | Replaced by a **single Google sign-in** granting identity + Gmail + Calendar. |

The general research in §1–§2 of the old file (BYOK rationale, provider-agnostic
model access, single-user scope) still holds, and is carried forward in
[PLAN.md](./PLAN.md) §2.

---

## Where to go instead

| You want | Read |
|---|---|
| The product definition and locked decisions | **[PLAN.md](./PLAN.md)** |
| Roadmap, phases, cost model, decision log | **[PLAN.md](./PLAN.md)** |
| How it runs on Cloudflare | **[ARCHITECTURE.md](./ARCHITECTURE.md)** |
| The AI layer: persona, tools, skills, autonomy | **[AI-SKILLS.md](./AI-SKILLS.md)** |
| Extensibility and built-in plugins | **[PLUGINS.md](./PLUGINS.md)** |
| REST/WebSocket surface | **[API.md](./API.md)** |
| Google sign-in | **[GOOGLE_OAUTH.md](./GOOGLE_OAUTH.md)** |

---

*Retained only as a record of the original thinking.*
