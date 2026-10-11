# ThreadMyMail — MVP UI Design

> **Status:** Draft for review. **Last updated:** 2026-10-06
> Companion to `mobile/MOBILE-STRATEGY.md`. Describes how the Android app's UI
> will look for the MVP (v1). The product is an **agent**, not an email client —
> every screen serves the agent or the mail it acts on.

---

## 1. Design principles

- **Dark-first.** The web app's identity is a dark cockpit (`#0b1326` /
  `#060e20` family). Carry it over. Light mode is a later toggle, not MVP.
- **Agent-centric.** The conversation with the agent is the heart. Mail is a
  surface the agent reads and writes, not a maze of folders.
- **Thumb-friendly.** Bottom navigation, large touch targets (≥48px), one
  primary action per screen.
- **Calm.** No neon overload; status is communicated with color + motion, not
  decoration (same rule as the web app).
- **Trust visible.** The kill switch and the activity log are always reachable.
  The user must always know what the agent is doing.

---

## 2. Navigation

Bottom tab bar, 5 tabs:

```
┌──────────────────────────────────────────────┐
│                                              │
│                  (screen)                    │
│                                              │
├──────────────────────────────────────────────┤
│  Today   Mail   Agent   Activity   Settings  │
└──────────────────────────────────────────────┘
```

- **Today** — the daily briefing (agent's summary of what needs attention).
- **Mail** — inbox list → thread view → compose.
- **Agent** — the live conversation/stream with the agent.
- **Activity** — the audit log of everything the agent did.
- **Settings** — email account, AI providers, skills, memory, kill switch.

A **kill switch** lives in the top bar of every screen (one press → agent stops
acting autonomously; manual runs stay available).

---

## 3. Onboarding flow (first launch)

```
Welcome → Connect email → Add AI key → (optional) pick skills → Done
```

1. **Welcome** — logo, one-line pitch ("Your inbox, run by an agent you
   control"), privacy note ("Your credentials and keys never leave this
   phone"), **Get started**.
2. **Connect email** — provider picker (Gmail / Outlook / Yahoo / iCloud /
   Custom) → email + **app password** → "Test connection" → success.
   - Custom expands to host/port/security fields.
   - Inline help: "App passwords: Gmail → Google Account → Security → 2-Step
     Verification → App passwords."
3. **Add AI key** — provider picker (OpenRouter / OpenAI / Anthropic / Gemini /
   DeepSeek / Custom) → base URL (prefilled for known providers) + API key +
   default model → "Test connection" → success.
4. **Pick skills (optional)** — toggle triage / drafts / follow-ups on or off.
   Can be skipped and configured later in Settings.
5. **Done** → lands on **Today**.

---

## 4. Screens

### 4.1 Today (home)

The agent's daily briefing.

```
┌──────────────────────────────────────────────┐
│ ☰  Today                    ⏻  kill switch   │
├──────────────────────────────────────────────┤
│  Good morning, Langat.                       │
│  12 unread · 3 need a reply · 2 follow-ups   │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  ▶ Run morning triage                  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  NEEDS YOUR EYE                              │
│  ┌────────────────────────────────────────┐  │
│  │ 📧 Contract — Acme (reply by 5pm)      │  │
│  │ 📧 Invoice — vendor                    │  │
│  │ ✅ Follow-up: proposal sent 3d ago     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  AGENT STATUS                                │
│  ● Idle · budget 62% left · quiet 22:00     │
└──────────────────────────────────────────────┘
```

- Top: greeting + counts (computed by the agent or a quick IMAP count).
- Primary action: **run the scheduled skill now**.
- "Needs your eye": agent-ranked items with one-tap open.
- Agent status strip: idle/running, daily budget, quiet hours.

### 4.2 Mail

**Inbox list** — newest-first, sender + subject + preview + unread dot.
Pull-to-refresh. Tap → thread.

**Thread view** — message list (MIME-rendered), reply box at bottom, and an
**"Ask the agent"** button that hands the thread to the Agent tab.

**Compose** — to/cc/subject/body, send via SMTP. "Draft with agent" button
pre-fills from the AI provider.

### 4.3 Agent (chat)

The live agent stream — the heart of the product.

```
┌──────────────────────────────────────────────┐
│ ←  Agent                    ⏻ kill switch    │
├──────────────────────────────────────────────┤
│  [Millo]  I found 3 threads waiting on you.  │
│           Top: Acme contract — reply by 5pm. │
│                                              │
│  [tool]  imap.search "from:acme"  ✓ 42ms     │
│  [tool]  memory.recall "acme contract" ✓     │
│                                              │
│  [Millo]  Want me to draft a reply?          │
│  ┌──────────┐ ┌──────────┐                   │
│  │  Yes     │ │  No      │                   │
│  └──────────┘ └──────────┘                   │
│                                              │
│  ─────────────────────────────────────────   │
│  ▸ type a message…                    [send] │
└──────────────────────────────────────────────┘
```

- Streamed tokens render as they arrive (the old WS message types: `token`,
  `tool_call`, `tool_result`, `artifact`, `escalation`, `done`, `error`).
- Tool calls shown as compact inline chips (name + args + latency + ✓/✗).
- **Escalations** render as choice cards (yes/no/always) — one tap, no typing.
- Input box for manual commands ("summarize today's mail").
- Kill switch in the header.

### 4.4 Activity

The audit log — everything the agent did, attributable to a run.

```
┌──────────────────────────────────────────────┐
│ ←  Activity                                   │
├──────────────────────────────────────────────┤
│  TODAY                                       │
│  08:12  run_9c2  triage        ✓ 3 drafts    │
│  08:12  run_9c2  sent reply    "Re: Acme"    │
│  07:00  run_7aa  follow-up     skipped (quiet)│
│  YESTERDAY                                   │
│  18:02  run_5f1  triage        ✓ 2 drafts    │
└──────────────────────────────────────────────┘
```

- Each row: time, run id, action, outcome. Tap a run to expand its tool calls.
- Reversible actions offer **Undo** where possible.

### 4.5 Settings

Scrollable sections:

| Section | Contents |
|---|---|
| **Email account** | Provider, email, app password (masked, edit), test connection, disconnect |
| **AI providers** | List of added providers (name, model, key masked) · **+ Add provider** · set **primary** · test · remove |
| **Skills** | List of skills with toggle + trigger + budget + quiet hours + shadow mode |
| **Memory** | Size/entries, **Clear memory** (destructive, confirm dialog) |
| **Guardrails** | Kill switch, daily budget, quiet hours, shadow/dry-run mode |
| **About** | Version, open-source links, privacy |

**Add provider** screen: name, base URL (prefilled per provider), API key,
default model, "Test connection" button, Save.

**Add skill** screen: name, instruction (free text), trigger (schedule /
on-new-mail / manual), time (if schedule), daily budget, quiet hours, shadow
toggle.

---

## 5. Key components

- **KillSwitch** — top-bar button, always visible; confirm on long-press.
- **AgentBubble** — streamed agent text; typing indicator while generating.
- **ToolChip** — inline tool-call card (name, args, latency, result).
- **EscalationCard** — question + choice buttons (yes/no/always).
- **ProviderCard** — provider summary with primary badge + test/remove.
- **SkillRow** — skill name + trigger + toggle + chevron to edit.
- **StatusStrip** — idle/running, budget %, quiet hours (on Today).

---

## 6. States to design for

- **Empty** — no email connected / no AI key: friendly setup prompts.
- **Loading** — first sync, agent thinking.
- **Error** — `ERR_AUTH` (bad app password → re-enter), `ERR_TLS`,
  `ERR_TIMEOUT`, provider `NO_API_KEY` / `NO_MODEL`.
- **Offline** — banner; agent actions disabled with a clear reason.
- **Budget exhausted** — agent refuses with the reason, manual runs still work.

---

## 7. Open questions

- **App name / package id** — `ThreadMyMail`? package `com.threadmymail.app`?
  (or match the domain: `com.omixsystems.threadmymail`).
- **Icon** — reuse the desired-logo artwork (`desired-logo.jpeg` at repo root).
- **Light mode** — MVP dark-only, or ship both?
- **Per-skill model override** — MVP or later?
