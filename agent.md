# Agent Guidelines & Development Roadmap (agent.md)

> **Role & Purpose**: This document provides exact instructions, conventions, architectural decisions, and visual prototypes for any AI agent or engineer continuing work on **ThreadMyMail**. Follow these principles to ensure consistency across backend, frontend, and mobile.

---

## 1. Frontend Reference & Visual Prototype

Before developing or modifying any frontend components in `threadmymail/frontend`:

- **Design Reference Prototype**: [Prototype Directory](file:///home/marvel/me/prototype)
- **Interactive UI Wireframe**: [Prototype index.html](file:///home/marvel/me/prototype/index.html)
- **UI Design System Spec**: [Prototype README.md](file:///home/marvel/me/prototype/README.md)

### Key UI/UX Principles (Confirmed with User):
1. **Layout**:
   - **Split 3-Pane + Expandable AI Drawer**:
     - Pane 1: Navigation & SaneBox-style smart bundles (`Urgent & VIP`, `SaneLater`, `Newsletters`).
     - Pane 2: Thread stream with urgency score badges (`Urgency 1-10`) and quick triage action icons (`Done`, `Snooze`, `Pin`).
     - Pane 3: Active reading pane featuring an **AI Executive Briefing** (3 key bullets) and **Extracted Action Items/Tasks** (Fireflies-style checkboxes).
     - Pane 4 (Collapsible Drawer / Sparkle button `⌘J`): Shortwave-style conversational AI assistant for querying the inbox, drafting replies, and setting reminders.
2. **Design Language & Theme**:
   - Clean, modern dark mode (`Zinc-900`/`Slate-950`) with subtle Indigo/Violet accents (`#6366f1` / `#8b5cf6`).
   - High contrast, typography-focused, distraction-free.
   - Built for keyboard-centric shortcuts (`E` for Done, `S` for Snooze, `P` for Pin, `⌘K` for Global Command Bar).
3. **Ghostwriter & Quick Reply**:
   - One-click reply pill recommendations above the reply box.
   - Tone selector (`Professional & Concise`, `Warm & Friendly`, `Urgent Confirmation`).
   - "AI Polish" button (`🪄`) to refine user-typed drafts before sending.

---

## 2. Core Architecture Rules & BYOK

- **AI Gateway**: Provider-agnostic via **OpenRouter** (`https://openrouter.ai/api/v1`) using LiteLLM. Users bring their own API keys (BYOK).
- **Backend**: Python FastAPI deployed to **Render** (`uvicorn app.main:app`).
- **Database**: PostgreSQL (managed on Render).
- **Frontend Stack**: React 18 + Vite + Tailwind CSS + Vite PWA Plugin (`threadmymail/frontend`).
- **Mobile**: React Native (Expo) built via EAS Build for Android APK.

---

## 3. Workflow for Incoming Agents

1. **Verify Prototype Compatibility**:
   - When building React components in `threadmymail/frontend/src/`, match the layout and class hierarchy demonstrated in [`prototype/index.html`](file:///home/marvel/me/prototype/index.html).
2. **Keep it Minimal & Fast**:
   - This is for personal use, not enterprise bloat. Avoid heavyweight dependencies. Stick to lightweight Tailwind utilities and standard React hooks.
3. **PWA First**:
   - Ensure all layouts are responsive and functional on both mobile viewport widths (using slide-over drawers) and wide desktop displays.
