# ThreadMyMail — Millo Chat Workspace Redesign (v3 — Android-Native)

> **Revision v3 — 2026-10-19.** Supersedes v2. The owner's revised Android design
> is incorporated: the desktop rail and tablet adaptations are dropped entirely,
> replaced by an Android navigation drawer, native chat behaviors, bottom
> sheets, and phone-designed wallpapers. The framework question is answered
> below (§1) — the implementation approach is locked to the project's actual
> technology: React Native via Expo.

## 1. Framework Answer (gates everything)

**The ThreadMyMail APK is React Native, not Kotlin/Compose, Flutter, or a WebView wrapper.**

Verified from the repository (`mobile-app/`):

- Expo SDK 57 (`expo ~57.0.26`), React Native 0.86.3, React 19.2.3, TypeScript
- `react-native-mail-engine` (Nitro native module — IMAP/SMTP/IDLE), `react-native-nitro-modules`
- `expo-sqlite`, `expo-secure-store`, `expo-video`, `react-native-safe-area-context`, `react-native-svg`
- Custom shell (`src/AppShell.tsx`) + custom `BottomTabBar` — **no react-navigation**
- No `android/` native UI code beyond what Expo prebuild generates; all screens are RN components

**Implementation consequences:**

- Every UI element in this spec is built with React Native components (View, FlatList, Modal, Pressable, Animated, BackHandler) plus Expo modules. No Jetpack Compose, no WebView.
- Do NOT introduce react-navigation just for the drawer — build a lightweight drawer consistent with the existing custom shell, or justify a minimal dependency in the final report.
- The coding agent must NOT switch frameworks or add a second UI paradigm.

## 2. Decisions Locked

| # | Decision | Choice |
|---|---|---|
| 1 | Target | **Android phone only.** No tablet layouts, no desktop rail, no permanent inspector. |
| 2 | Framework | React Native / Expo (existing). No new UI framework. |
| 3 | Theme | **Dark-only.** `src/theme/theme.ts` is the token source of truth. |
| 4 | Navigation | Swipe-accessible **navigation drawer** + compact **bottom bar** (Millo as a tab). Drawer covers the screen; never a permanent sidebar. |
| 5 | Conversation persistence | **Now in scope (minimal, on-device).** The drawer's recent conversations, conversation titles, per-conversation wallpaper overrides, and scroll-position preservation all require conversation identity. Use `expo-sqlite` (already a dependency). No backend, no cloud sync. *(v3 change — supersedes v2's "UI-only" deferral.)* |
| 6 | Wallpapers | Behind the chat messages only. App bar, navigation, and composer keep legible surfaces. Global default + per-conversation override. Custom images via the **Android system Photo Picker** (no broad media permissions), stored on-device. |
| 7 | Structured outputs | Render only what the agent emits today (agent text, tool chips, escalations, notices). Draft/follow-up cards open **review sheets** when those outputs exist. |
| 8 | Secondary actions | **Android bottom sheets** for email-context selection, draft/follow-up review, wallpaper picking, conversation options. |

## 3. Current State (audited 2026-10-19)

The live product is the Expo app in `mobile-app/`. The web `frontend/` is parked (landing + download page).

| Path | Role |
|---|---|
| `mobile-app/src/AppShell.tsx` | Shell; wraps everything in an `ImageBackground` (`assets/app-background.png`) — to be replaced by the wallpaper system |
| `mobile-app/src/screens/AgentScreen.tsx` | The Millo conversation screen: FlatList stream, typewriter streaming, auto-scroll, KeyboardAvoidingView, kill switch, suggestion chips |
| `mobile-app/src/components/agent.tsx` | `AgentBubble`, `EscalationCard`, `ToolChip`, `TypingIndicator` |
| `mobile-app/src/components/mail.tsx` | Inbox components incl. `Composer` |
| `mobile-app/src/components/BottomTabBar.tsx` | Bottom tab navigation (Today / Mail / Agent / Activity / Settings) |
| `mobile-app/src/components/TopBar.tsx` | Top bar |
| `mobile-app/src/screens/` | Today, Mail, Agent, Activity, Settings, Onboarding |
| `mobile-app/src/theme/theme.ts` | Dark token system: bg `#0B1326`, primary `#7C3AED`, accent `#0891B2`, Inter, radii 8/12/16/20, motion 150–300ms, 48dp touch targets |

**Exists today:** streaming (typewriter), tool chips, escalation cards, notices, kill switch, empty state + suggestion chips, auto-scroll, KeyboardAvoidingView composer, Millo label.

**Does not exist:** conversation persistence/history, conversation titles, drawer, search, message long-press actions, stop-generation, per-conversation settings.

## 4. Product Identity and Empty State

Millo is the assistant name across the Agent screen: header, attribution, empty state, composer placeholder ("Message Millo…"), and assistant settings. ThreadMyMail remains the product name in onboarding, branding, and settings.

Empty state (the target, from the owner's concept):

- Heading: **"What can I help you with?"**
- Supporting line: **"Your inbox, conversations, and next steps."**
- Starter actions, each wired to real behavior:
  - **Draft a reply** — respond using email context
  - **Find commitments** — review tasks and deadlines
  - **Review follow-ups** — see what needs attention
- The empty state and the existing quick suggestion chips must merge into one mechanism — no duplicates.
- No oversized welcome messages, illustrations, or marketing copy. It disappears when the conversation begins.

## 5. Navigation — Android Drawer + Bottom Bar

### 5.1 Navigation drawer (replaces the desktop rail)

- Opens by tapping the menu icon in the top app bar or swiping from the left edge.
- **Overlay drawer**: covers part of the screen; the chat never permanently loses width. No permanently visible sidebar on phones.
- Dismisses with the system back gesture, an outside tap, or a swipe.
- Contents:
  - **Recent conversations** (from the on-device conversation store, §8) + **New Chat**
  - **Search** — searches conversations and, where supported, email
  - **Inbox** — existing Mail screen
  - **Actions** — existing Activity screen
  - **Follow-ups** — only when the follow-ups feature exists; never ship a placeholder page
  - **Settings** — existing Settings screen
- Active destination is clearly indicated; all items meet the 48dp touch minimum with accessible labels.

### 5.2 Bottom bar (compact, primary destinations only)

- Keep a compact bottom navigation bar with **Millo as one of the tabs**.
- Owner's concept: **Inbox · Millo · Actions · Settings** (4 tabs). Current app has 5 (Today / Mail / Agent / Activity / Settings).
  - Mapping: Inbox → Mail, Millo → Agent, Actions → Activity, Settings → Settings.
  - **Open question for the owner:** what happens to **Today** — fold it into Inbox/Actions, or keep it as a fifth tab? Decide before Phase 2; do not delete the screen either way.
- Avoid duplicating every drawer item in the bottom bar. Drawer = full destination list + conversations; bottom bar = the few primary destinations.

## 6. Native Android Chat Behavior

Millo's conversation screen must feel native, not like a web page:

- **Full-height conversation area** that scrolls naturally (FlatList, inverted or bottom-anchored as already implemented).
- **Composer anchored above the keyboard** using proper window inset handling (`react-native-safe-area-context` + edge-to-edge insets; verify `windowSoftInputMode=adjustResize` in app config).
- **Multiline composer** that expands to a sensible maximum height (suggest ~5 lines), then scrolls internally.
- **Streaming responses with a stop-generation control** — a stop affordance while streaming that halts the current generation without engaging the global kill switch.
- **Long-press actions** on messages: copy text at minimum; overflow options (e.g., copy, select email as context) via a bottom sheet.
- **Message-level references** that open the corresponding email thread in the existing Mail screen.
- **Draft and follow-up cards** (when those outputs exist) that open **review sheets** — never cramped inline editors.
- **Conversation title + overflow menu in the top app bar**: rename, wallpaper, clear/delete conversation, context options.
- **Bottom sheets** for secondary actions: email-context selection, draft/follow-up review, wallpaper picker, conversation options.
- **Back gesture ordering**: keyboard → sheet → drawer → navigation. The system back must dismiss the topmost transient surface before navigating away (BackHandler; predictive-back compatible where supported).

## 7. Wallpapers Designed for Phones

The wallpaper applies **behind the chat messages only**. The app bar, bottom navigation, drawer, and composer retain their own legible surfaces — they do not become transparent windows onto the wallpaper.

### Built-in presets (local assets, appropriately licensed — no external URLs)

| Preset | Mood |
|---|---|
| Default | The current `app-background.png` look (preserves today's identity) |
| Plain | Flat dark neutral, no image |
| Linen | Warm, subtle fabric texture |
| Midnight | Soft dark gradient |
| Landscape | Restrained, serene landscape |

Assets are bundled and lightweight; do not bundle a large collection or download wallpapers at runtime.

### Picker UX

Opens as a **full-height bottom sheet** (or a dedicated appearance screen if the sheet proves cramped):

- Built-in wallpaper gallery (thumbnails)
- Gallery/photo-picker action for custom images — **use Android's system Photo Picker** (via `expo-image-picker`, which routes to the system picker on modern Android; no broad `READ_MEDIA_IMAGES` permission)
- Live preview
- Crop/fit controls where practical
- Dimming adjustment (readability overlay; default near the existing `colors.scrim`)
- Apply / Reset actions

Validation: JPG/PNG/WebP, sensible size cap (~10 MB), downscale and copy into app storage (content URIs are revocable). Clear errors for unsupported or oversized files. Never claim a save succeeded if it failed.

### Scope and persistence

- **Global default** wallpaper for all conversations, plus **per-conversation overrides** (v3: in scope, enabled by the conversation store in §8).
- Precedence: conversation override > global default; resetting the override returns to the global default.
- Persist with the app's existing on-device mechanisms (`expo-sqlite` / local preference storage). Restore on launch and after process recreation.
- Dark-only readability: all text (#F1F5F9), bubbles, composer, links, and focus indicators must remain legible over every preset and over light-toned custom photos, at every dim level.

## 8. Conversation Persistence (minimal, on-device)

New in v3 — required by the drawer, titles, wallpaper overrides, and scroll preservation:

- Minimal `expo-sqlite` store: conversations (id, title, created/updated, wallpaper override) and messages (conversation id, role, text, references, timestamps).
- The existing AgentScreen in-memory stream becomes backed by this store: opening a conversation restores its history; New Chat creates one; the drawer lists them by recency.
- On-device only. No backend, no sync, no new storage provider. Migrations must be additive and must not touch the existing mail tables.
- Deleting a conversation removes its messages and override; confirm before deleting.

## 9. Android Implementation Requirements

- **Keyboard resizing**: `adjustResize` behavior; composer tracks the keyboard via insets, not hardcoded offsets.
- **Edge-to-edge system insets**: status bar and gesture-nav areas respected via `react-native-safe-area-context`; no content under system bars unless intentionally drawn there.
- **Predictive back compatibility** where supported: transient surfaces (keyboard, sheet, drawer) opt into back dismissal correctly.
- **Rotation handling**: conversation state and scroll position survive configuration changes.
- **Process recreation**: restore the last conversation, wallpaper preference, and draft text after Android kills and relaunches the process.
- **Efficient image decoding**: downscale wallpapers to screen resolution; apply EXIF orientation; avoid decoding full-size photos into memory.
- **Scroll position preservation** when switching between conversations; returning to a conversation restores where the user was.
- **Forbidden on phone screens**: fixed 1440px layouts, permanent right-side inspectors, hover tooltips, desktop keyboard shortcuts as primary interactions, web-style navigation components.

## 10. Visual Design System

`src/theme/theme.ts` remains the single source of truth (dark cockpit: bg `#0B1326`, primary `#7C3AED`, accent `#0891B2`, Inter, radii 8/12/16/20, motion 150–300ms, 48dp targets). No hardcoded hex values in components.

- Main text 14–16 (`body`/`bodySmall`); labels 12; screen headings `h2`/`h3`.
- Restrained radii for ordinary controls; reserve `xl`/pill for cards, sheets, chips.
- Avoid: excessive gradients/shadows, rounded cards around every message, large decorative icons, arbitrary KPI cards, inconsistent icons, unnecessary animation, low-contrast text over wallpapers.
- One icon family: the existing `Icons.tsx` set.
- Respect reduced-motion preferences.

## 11. Preserve Existing Functionality

Do not break or replace:

- Mail connection (app-password IMAP/SMTP via `react-native-mail-engine`), Gmail-style inbox, 180-day sync, realtime IDLE.
- The agent loop, streaming, tool execution, escalations, kill switch, budgets/quiet hours.
- Onboarding flow, welcome video, settings, secure key storage.
- The mail-engine patch script (`scripts/patch-mail-engine.js` postinstall) and Android build config (packagingOptions dedupe, ABI CI inputs, release signing).

All email mutations continue through the existing authorized service layer. Explicit confirmation before externally visible actions (escalation cards). Prevent duplicate sends on retry. Do not weaken authorization or expose secrets. Additive sqlite migrations only; no destructive schema changes or rewrites.

## 12. Build Order

1. **Audit and baseline** *(largely done — see §3)*: record a green typecheck + Android build before changes.
2. **Mobile chat layout + native top app bar**: full-height conversation, inset-aware composer, conversation title + overflow menu, stop-generation control.
3. **Conversation store (minimal)**: expo-sqlite conversations/messages; wire the current stream to it; New Chat + restore.
4. **Navigation drawer**: overlay drawer with recent conversations, New Chat, Search, and the existing destinations; resolve the Today-tab question; back-gesture ordering.
5. **Messages, streaming, composer, context, review sheets**: long-press actions, message references to email threads, bottom sheets for context selection and (when they exist) draft/follow-up review.
6. **Wallpaper system**: extract the wallpaper layer from AppShell to the chat canvas; built-in presets; picker sheet with Photo Picker, preview, dim, Apply/Reset; global + per-conversation persistence.
7. **Test on a real Android-sized screen**: keyboard behavior, system navigation/gestures, rotation, process recreation, slower devices; verify every acceptance criterion; screenshot the real result.

Keep changes incremental; resolve regressions before proceeding. Do not implement all phases in one unreviewed rewrite.

## 13. Acceptance Criteria

Complete only when:

1. Millo is consistently named; the empty state matches §4 with working starter actions.
2. The drawer opens (menu + edge swipe), overlays the chat, and dismisses via back, outside tap, and swipe.
3. The drawer lists real recent conversations; New Chat works; no placeholder destinations.
4. The bottom bar is compact, includes Millo, and does not duplicate the full drawer list.
5. Conversations persist across app restarts and process recreation; titles are editable.
6. Streaming works with a functional stop-generation control; the kill switch still works.
7. Long-press copy works; message references open the correct email thread.
8. The wallpaper picker offers built-ins + custom upload via the system Photo Picker, with preview, dim, Apply/Reset.
9. Wallpaper applies behind messages only; app bar, nav, and composer stay legible; per-conversation override and reset follow the precedence rule.
10. Wallpaper changes never clear the conversation, restart streams, or alter navigation state.
11. Back gesture dismisses keyboard → sheet → drawer in the right order before navigating.
12. Rotation and process recreation preserve conversation, scroll position, and wallpaper.
13. No new backend, remote storage, broad media permissions, or second UI framework.
14. Typecheck and the Android build pass; pre-existing failures documented.
15. Verified on a real Android-sized screen, including keyboard and gesture navigation.

## 14. Final Report

Provide:

- Framework confirmation and any architecture discovered beyond §3.
- Completed UI changes and modified files.
- Conversation store schema and migration notes.
- Wallpaper storage, persistence, and precedence explanation.
- Any new dependency (e.g., `expo-image-picker`), with justification.
- Typecheck/build results and on-device verification notes (keyboard, gestures, rotation, process death).
- Known limitations and remaining work (e.g., Follow-ups destination, Today-tab resolution, structured renderers awaiting agent outputs).

Do not claim a feature is implemented merely because a component exists. Verify the real interactions and data flow on a device.

**Guiding principle:** an Android-first Millo — full-screen chat, slide-out conversation drawer, native-feeling interactions, customizable conversation wallpapers — with all existing ThreadMyMail functionality intact.
