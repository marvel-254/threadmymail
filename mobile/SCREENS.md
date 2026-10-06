# ThreadMyMail Mobile — Screen Specs

**Author:** Angel (UI/UX Pro Max) · **Date:** 2026-10-06
**Companion to:** `mobile/MVP-UI.md` · `mobile/COMPONENT-SPEC.md` · Tokens: `mobile/theme.ts`
**DB sources:** AI-Native UI, Minimalism & Swiss, Touch Target Size, Touch Spacing, Confirmation Dialogs, Empty States, Streaming, Feedback Loop, Disclaimer, Contextual Live Badge, Submit Feedback, Confirmation Messages.

All screens are **dark-first**, **thumb-friendly** (≥48dp targets, 8px gaps), and reference tokens from `theme.ts` — never hardcoded hex. Kill switch lives in the top bar of every screen except Activity (read-only) and Settings (it IS the control room).

---

## Navigation

Bottom tab bar, 5 tabs (component #8):

```
┌──────────────────────────────────────────────┐
│                  (screen)                    │
├──────────────────────────────────────────────┤
│  Today   Mail   Agent   Activity   Settings  │
└──────────────────────────────────────────────┘
```

- **Today** — daily briefing
- **Mail** — inbox → thread → compose
- **Agent** — live conversation (the heart)
- **Activity** — audit log
- **Settings** — control room

---

## Screen 1 — Today (home)

The agent's daily briefing.

```
┌──────────────────────────────────────────────┐
│  ☰  Today                    ⏻ kill switch      │
├──────────────────────────────────────────────┤
│  Good morning, Langat.                        │
│  12 unread · 3 need a reply · 2 follow-ups       │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  ▶ Run morning triage                  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  NEEDS YOUR EYE                                │
│  ┌────────────────────────────────────────┐  │
│  │  📧 Contract — Acme (reply by 5pm)      │  │
│  │  📧 Invoice — vendor                    │  │
│  │  ✅ Follow-up: proposal sent 3d ago     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  AGENT STATUS                                  │
│  ● Idle · budget 62% left · quiet 22:00       │
│                                                │
│  [ Today  Mail  Agent  Activity  Settings ]    │
└──────────────────────────────────────────────┘
```

**Layout**
- Header: `☰` menu (48dp) · "Today" · kill switch
- Greeting: `typography.h1` (28/600), `colors.text` — "Good morning, Langat."
- Counts: `typography.bodySmall`, `colors.textMuted` — "12 unread · 3 need a reply · 2 follow-ups"
- Primary action: "Run morning triage" — full-width, `colors.primary` bg, ≥48dp
- Needs attention: section label + stacked cards (tap → open thread)
- Agent status: `StatusStrip` (idle/running, budget %, quiet hours)

**States:** empty (no email → EmptyState "Connect your inbox"), loading (skeleton shimmer), error (`ERR_*` banner + retry), offline (banner + disabled action), budget exhausted (refuse with reason).

---

## Screen 2 — Mail

### 2a. Inbox List

```
┌──────────────────────────────────────────────┐
│  ←  Inbox                    ⏻ kill switch      │
├──────────────────────────────────────────────┤
│  ●  Acme Corp        Contract — Acme   09:41  │
│     "Attached the signed contract for…"       │
│  ●  Vendor Inc       Invoice #4821     08:15  │
│     "Please remit payment for the…"           │
│  ○  GitHub           [ThreadMyMail] CI  07:02 │
│     "Build #1234 failed on main…"             │
│  ○  Mom              Re: Dinner        06:30  │
│     "Sounds great, see you at 7!"             │
│                                              │
│  [ Today  Mail  Agent  Activity  Settings ]    │
└──────────────────────────────────────────────┘
```

- Header: back · "Inbox" · kill switch
- `MailRow` list (component #9): avatar → sender + subject + preview → time
- Unread dot 8px `colors.primary`; unread rows bold sender
- Pull-to-refresh (native `RefreshControl`)
- Account switcher: top-left avatar tap → account sheet (multi-account)

**States:** empty, loading (skeleton), error (`ERR_AUTH` → re-enter password; `ERR_TLS`/`ERR_TIMEOUT` → retry), offline (banner + cached list).

### 2b. Thread View

```
┌──────────────────────────────────────────────┐
│  ←  Acme Corp                    ⏻ kill switch  │
├──────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  │
│  │  Contract — Acme                       │  │
│  │  Acme Corp <legal@acme.com> · 09:41    │  │
│  │  ───────────────────────────────────── │  │
│  │  Attached the signed contract for the  │  │
│  │  Q3 renewal. Please review and return. │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │  [Millo]  I can draft a reply.          │  │
│  │  Want me to?                           │  │
│  │  ┌──────────┐ ┌──────────┐             │  │
│  │  │  Yes     │ │  No      │             │  │
│  │  └──────────┘ └──────────┘             │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Reply…                    [Ask agent] │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  [ Today  Mail  Agent  Activity  Settings ]    │
└──────────────────────────────────────────────┘
```

- Header: back · sender · kill switch
- Message list: MIME-rendered, `colors.surface` cards, `radii.lg`
- "Ask the agent" button: `colors.accent` text in reply bar → hands thread to Agent tab
- Reply box: `Composer`-style input, send via SMTP
- Agent suggestion: inline `EscalationCard` — "I can draft a reply. Want me to?" → Yes/No

**States:** empty thread, loading, error (`ERR_AUTH` → re-enter password).

### 2c. Compose

```
┌──────────────────────────────────────────────┐
│  ←  New message                  Send  ▸      │
├──────────────────────────────────────────────┤
│  To:    acme@corp.com                        │
│  Cc:    (optional)                           │
│  Subject:  Re: Contract — Acme               │
│  ─────────────────────────────────────────── │
│  Hi Acme team,                               │
│                                              │
│  Thanks for sending the contract. I've       │
│  reviewed it and…                            │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  ✨ Draft with agent                    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  [ Today  Mail  Agent  Activity  Settings ]    │
└──────────────────────────────────────────────┘
```

- Header: back · "New message" · **Send** (48dp, `colors.primary`, disabled until valid)
- Fields: To / Cc / Subject — `.field` pattern, `colors.surface` inputs
- Body: multiline textarea, `typography.body`
- "Draft with agent": `colors.accent` bg — pre-fills body from AI provider
- Send: SMTP via email bridge; success → toast + back to inbox

**States:** drafting (spinner → pre-filled body), sending (spinner, disabled), sent (toast "Message sent"), error (`ERR_AUTH`/`ERR_TIMEOUT` → banner, keep draft).

---

## Screen 3 — Agent (the heart)

The live conversation stream.

```
┌──────────────────────────────────────────────┐
│  ←  Agent                    ⏻ kill switch      │
├──────────────────────────────────────────────┤
│  [Millo]  I found 3 threads waiting on you.   │
│           Top: Acme contract — reply by 5pm.  │
│                                              │
│  [tool]  imap.search "from:acme"  ✓ 42ms      │
│  [tool]  memory.recall "acme contract"  ✓     │
│                                              │
│  [Millo]  Want me to draft a reply?           │
│  ┌──────────┐ ┌──────────┐                   │
│  │  Yes     │ │  No      │                   │
│  └──────────┘ └──────────┘                   │
│                                              │
│  ─────────────────────────────────────────   │
│  ▸ type a message…                    [send] │
│                                              │
│  [ Today  Mail  Agent  Activity  Settings ]    │
└──────────────────────────────────────────────┘
```

- Header: back · "Agent" · kill switch
- Message list: `AgentBubble` + `ToolChip` + `EscalationCard`
- Stream: tokens append as they arrive (DB: Streaming — never a 10s spinner)
- Tool calls inline as chips — the honesty surface
- Composer at bottom — manual commands
- Kill switch in header

**Message types:** `token` (append), `tool_call` (ToolChip running), `tool_result` (ToolChip ✓/✗), `artifact` (inline card), `escalation` (EscalationCard), `done` (run summary + feedback), `error` (danger bubble + retry).

**States:** empty (EmptyState + suggestion chips), loading (typing indicator), error (`NO_API_KEY`/`NO_MODEL` → banner + jump to Settings), offline (banner + disabled composer), budget exhausted (refuse with reason).

---

## Screen 4 — Activity

The audit log — trust surface.

```
┌──────────────────────────────────────────────┐
│  ←  Activity                                  │
├──────────────────────────────────────────────┤
│  TODAY                                       │
│  08:12  run_9c2  triage        ✓ 3 drafts    │
│  08:12  run_9c2  sent reply    "Re: Acme"    │
│  07:00  run_7aa  follow-up     skipped (quiet)│
│  YESTERDAY                                   │
│  18:02  run_5f1  triage        ✓ 2 drafts    │
│  17:45  run_5f1  sent reply    "Re: Vendor"  │
│  17:45  run_5f1  draft         ✓ saved       │
│                                              │
│  [ Today  Mail  Agent  Activity  Settings ]    │
└──────────────────────────────────────────────┘
```

- Header: back · "Activity" (no kill switch — read-only)
- Grouped by day: "TODAY" / "YESTERDAY" section labels
- ActivityRow: time → run id (mono) → action → outcome (✓/✗/skipped)
- Tap a run → expands tool calls (ToolChips)
- Undo on reversible actions

**States:** empty (EmptyState "Nothing yet"), loading (skeleton), error (banner + retry).

---

## Screen 5 — Settings

The control room. Scrollable sections.

```
┌──────────────────────────────────────────────┐
│  ←  Settings                                  │
├──────────────────────────────────────────────┤
│  EMAIL ACCOUNT                                │
│  Gmail · langat@gmail.com                     │
│  ● Connected          [Test] [Edit]           │
│                                              │
│  AI PROVIDERS                                 │
│  OpenRouter · gpt-4o-mini   ★ PRIMARY        │
│  ● Connected          [Test] [Remove]         │
│  + Add provider                               │
│                                              │
│  SKILLS                                      │
│  Triage          Schedule 08:00   ●   ›       │
│  Draft replies   On new mail    ○   ›         │
│  Follow-ups      Manual         ○   ›         │
│  + Add skill                                  │
│                                              │
│  MEMORY                                      │
│  128 entries · 2.4 MB              [Clear]    │
│                                              │
│  GUARDRAILS                                  │
│  Kill switch        ●  engaged                │
│  Daily budget       $0.50 / day               │
│  Quiet hours        22:00 – 07:00             │
│  Shadow mode        ○  off                    │
│                                              │
│  ABOUT                                       │
│  Version 0.1.0 · Open source · Privacy        │
│                                              │
│  [ Today  Mail  Agent  Activity  Settings ]    │
└──────────────────────────────────────────────┘
```

- Header: back · "Settings" (no kill switch — it IS the control room)
- Sections: Email account, AI providers, Skills, Memory, Guardrails, About
- Sub-screens: Add provider (ProviderForm), Add skill (SkillForm), Edit email
- Destructive actions (Clear memory, Remove provider, Disconnect) → ConfirmDialog

**States:** empty (no email → EmptyState "Connect your inbox"), error (`ERR_AUTH` inline), testing (spinner → ✓/✗).

---

## Onboarding Flow (first launch)

```
Welcome → Connect email → Add AI key → (optional) pick skills → Done
```

1. **Welcome** — logo, one-line pitch ("Your inbox, run by an agent you control"), privacy note ("Your credentials and keys never leave this phone"), **Get started**
2. **Connect email** — provider picker (Gmail/Outlook/Yahoo/iCloud/Custom) → email + app password → "Test connection" → success. Custom expands to host/port/security.
3. **Add AI key** — provider picker (OpenRouter/OpenAI/Anthropic/Gemini/DeepSeek/Custom) → base URL (prefilled) + API key + default model → "Test connection" → success.
4. **Pick skills (optional)** — toggle triage/drafts/follow-ups. Can be skipped.
5. **Done** → lands on **Today**

**DB grounding:** Skip + Back on every step (User Freedom), Empty States with action, Submit Feedback (test connection loading → success/error).

---

*Screen specs complete. Implementation follows in `mobile/` (Expo SDK 53, TypeScript, expo-router).*
