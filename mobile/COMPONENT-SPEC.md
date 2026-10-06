# ThreadMyMail Mobile — Component Spec

**Author:** Angel (UI/UX Pro Max) · **Date:** 2026-10-06
**Companion to:** `mobile/MVP-UI.md` §5 · **Tokens:** `mobile/theme.ts`
**DB sources:** AI-Native UI (design-system), Minimalism & Swiss (style), Touch Target Size / Touch Spacing / Confirmation Dialogs / Empty States / Streaming / Feedback Loop / Disclaimer (ux), Modern Dark Cinema (typography).

Every component below is **dark-first**, **thumb-friendly** (≥48dp targets, 8px gaps), and references tokens from `theme.ts` — never hardcoded hex.

---

## 1. KillSwitch

**Purpose:** Always-visible trust control. One press → agent stops acting autonomously; manual runs stay available.

| Property | Value |
|---|---|
| Placement | Top bar, right side, every screen |
| Size | 48×48dp (touch target) |
| Icon | SVG power icon (Lucide `power`), 22px |
| Idle | `colors.textMuted` on transparent |
| Engaged | `colors.danger` icon on `colors.dangerBg` background, rounded |
| Long-press | Opens confirm dialog (DB: Confirmation Dialogs — prevent accidental destructive) |
| Label | `aria-label="Kill switch"` / `accessibilityLabel="Kill switch"` |

**States:** `idle` (muted) → `engaged` (danger, filled) → `confirming` (dialog open).

```tsx
// KillSwitch.tsx (concept)
<Pressable
  accessibilityLabel="Kill switch"
  onLongPress={openConfirm}
  style={({ pressed }) => [
    { width: 48, height: 48, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
    engaged && { backgroundColor: colors.dangerBg },
    pressed && { backgroundColor: colors.surfaceHover },
  ]}
>
  <PowerIcon size={22} color={engaged ? colors.danger : colors.textMuted} />
</Pressable>
```

---

## 2. AgentBubble

**Purpose:** Streamed agent text with typing indicator.

| Property | Value |
|---|---|
| Background | `colors.surface` |
| Radius | `radii.lg` (16) with one corner `radii.sm` (8) toward sender |
| Padding | `spacing.md` (12) horizontal, `spacing.sm` (8) vertical |
| Max width | 85% of screen |
| Text | `typography.body` (16/400), `colors.text` |
| Typing indicator | 3-dot pulse (DB: typing indicators) — three 6px dots, `colors.textMuted`, staggered opacity animation |
| Streaming | Tokens append as they arrive (DB: Streaming — never a 10s spinner) |

**States:** `streaming` (typing indicator + partial text), `complete` (full text + feedback row), `error` (danger text + retry).

**Feedback row** (DB: Feedback Loop — thumbs up/down or Regenerate): two 40dp icon buttons below the bubble, `colors.textMuted`, active state `colors.primary`. Always present on complete agent messages.

**AI label** (DB: Disclaimer — users know they talk to AI): small `label`-style caption "AI" above the bubble, `colors.textSubtle`.

```tsx
// AgentBubble.tsx (concept)
<View style={{ alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: colors.surface, borderRadius: radii.lg, borderTopLeftRadius: radii.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
  <Text style={typography.body}>{text}</Text>
  {streaming && <TypingIndicator />}
  {complete && <FeedbackRow />}
</View>
```

---

## 3. ToolChip

**Purpose:** Inline tool-call card (name + args + latency + ✓/✗). The agent's honesty surface — "what did it just do?"

| Property | Value |
|---|---|
| Background | `colors.surfaceStrong` |
| Radius | `radii.md` (12) |
| Padding | `spacing.sm` (8) × `spacing.md` (12) |
| Layout | Row: icon → name (mono, `colors.primary`) → args (mono, `colors.textMuted`) → latency (`colors.textSubtle`) → status icon |
| Status | ✓ `colors.success` · ✗ `colors.danger` |
| Tap | Expands to show full args/result (collapsed by default) |

**States:** `running` (pulse border `colors.borderPrimary`), `success` (✓), `error` (✗ + `colors.danger` name).

```tsx
// ToolChip.tsx (concept)
<Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceStrong, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: touch.minTarget }}>
  <Text style={[typography.mono, { color: colors.primary, fontWeight: '600' }]}>{name}</Text>
  <Text style={[typography.mono, { color: colors.textMuted }]} numberOfLines={1}>{args}</Text>
  <Text style={[typography.caption, { color: colors.textSubtle }]}>{latency}ms</Text>
  <StatusIcon ok={ok} />
</Pressable>
```

---

## 4. EscalationCard

**Purpose:** Question + choice buttons (yes/no/always) — one tap, no typing.

| Property | Value |
|---|---|
| Background | `colors.surface` |
| Border | `colors.borderPrimary` (1px) — signals "agent needs you" |
| Radius | `radii.lg` (16) |
| Question | `typography.body` (16/600), `colors.text` |
| Choice buttons | ≥48dp tall, `radii.md`, 8px gap |
| Primary choice | `colors.primary` bg, `colors.textOnPrimary` text |
| Secondary choices | `colors.surfaceStrong` bg, `colors.text` text, `colors.border` border |
| "Always" | Text button, `colors.textMuted` — remembers preference |

**States:** `pending` (choices enabled), `answered` (chosen button fills `colors.primary`, others dim to `colors.textSubtle`).

---

## 5. ProviderCard

**Purpose:** AI provider summary with primary badge + test/remove.

| Property | Value |
|---|---|
| Layout | Row: provider icon → name + model (stacked) → primary badge → actions |
| Name | `typography.body` (16/600), `colors.text` |
| Model | `typography.caption`, `colors.textMuted` |
| Primary badge | `colors.primary` bg pill, `colors.textOnPrimary`, `label` style |
| Test button | `colors.accent` text, `colors.accentDark` pressed |
| Remove | `colors.danger` text (opens confirm dialog — DB: Confirmation Dialogs) |
| Key masked | `••••` + last 4, `colors.textSubtle` |

**States:** `connected` (✓ `colors.success`), `error` (✗ `colors.danger` + message), `testing` (spinner).

---

## 6. SkillRow

**Purpose:** Skill name + trigger + toggle + chevron to edit.

| Property | Value |
|---|---|
| Layout | Row: name + trigger (stacked) → toggle → chevron |
| Name | `typography.body` (16/600), `colors.text` |
| Trigger | `typography.caption`, `colors.textMuted` (e.g. "Schedule · 08:00") |
| Toggle | 48dp switch, `colors.primary` when on, `colors.surfaceStrong` when off |
| Chevron | `colors.textSubtle`, 20px |
| Shadow mode | Amber dot (`colors.warn`) before name — signals dry-run |

**States:** `on` / `off` / `shadow` (dry-run, amber indicator).

---

## 7. StatusStrip

**Purpose:** Idle/running, budget %, quiet hours (on Today).

| Property | Value |
|---|---|
| Background | `colors.surface` |
| Radius | `radii.md` (12) |
| Layout | Row: status dot → text → budget → quiet hours |
| Status dot | 8px, `colors.success` (idle) / `colors.primary` (running, pulsing) / `colors.warn` (quiet) |
| Text | `typography.bodySmall`, `colors.textMuted` |
| Budget | `typography.caption`, `colors.textSubtle` — "62% left" |
| Quiet hours | `typography.caption`, `colors.warn` — "quiet 22:00" |

**Accessibility:** announce as a single atomic status message (DB: Contextual Live Badge — "Agent idle, 62% budget left, quiet hours 22:00"), not a bare number.

---

## 8. Bottom Tab Bar

**Purpose:** 5-tab navigation — Today · Mail · Agent · Activity · Settings.

| Property | Value |
|---|---|
| Height | `spacing.tabBar` (64) + safe-area inset |
| Background | `colors.bgDeep` with `colors.border` top border |
| Tab | ≥48dp, icon 22px + label 11px |
| Active | `colors.primary` icon + label, `colors.textMuted` inactive |
| Agent tab | Center — slightly raised, `colors.primary` filled circle 56dp with white icon (distinct, since it's the heart) |

**Active tab indicator:** 3px `colors.primary` bar above icon (not just color — DB: color-not-only-indicator).

---

## 9. MailRow (inbox list)

**Purpose:** Sender + subject + preview + unread dot. Tap → thread.

| Property | Value |
|---|---|
| Height | ≥72dp (comfortable) |
| Layout | Row: avatar (40dp) → sender + subject + preview (stacked) → time |
| Sender | `typography.bodySmall` (14/600), `colors.text` |
| Subject | `typography.bodySmall` (14/400), `colors.textMuted` |
| Preview | `typography.caption` (12), `colors.textSubtle`, `numberOfLines={1}` |
| Unread dot | 8px `colors.primary` circle, left of avatar |
| Time | `typography.caption`, `colors.textSubtle` |
| Pressed | `colors.surfaceHover` background |

**States:** `unread` (dot + bold sender), `read` (no dot, normal), `selected` (border `colors.borderPrimary`).

---

## 10. Composer (Agent chat input)

| Property | Value |
|---|---|
| Container | `colors.surface` bg, `radii.xl` (20), `colors.border` border |
| Input | `typography.body` (16), `colors.text`, placeholder `colors.textSubtle` |
| Send button | 48dp circle, `colors.primary` bg, white send icon |
| Disabled | `colors.surfaceStrong` bg, `colors.textSubtle` icon (when offline / no key) |

**States:** `idle` / `focused` (border `colors.borderPrimary`) / `disabled` (offline, no key, budget exhausted — with reason banner above).

---

## 11. EmptyState

**Purpose:** Guide users when no content exists (DB: Empty States — never blank).

| Property | Value |
|---|---|
| Layout | Centered: icon (48px, `colors.textSubtle`) → title → body → action |
| Title | `typography.h3` (18/600), `colors.text` |
| Body | `typography.bodySmall`, `colors.textMuted`, centered, max-width 280 |
| Action | Primary button (≥48dp) or text link (`colors.accent`) |
| Icon | SVG (Lucide), `colors.textSubtle` |

**Examples:** "No email connected yet — Connect your inbox", "No AI key yet — Add your provider", "Nothing in your inbox — the agent will surface what needs you."

---

## 12. ConfirmDialog

**Purpose:** Prevent accidental destructive actions (DB: Confirmation Dialogs).

| Property | Value |
|---|---|
| Backdrop | `colors.overlay` |
| Card | `colors.surfaceStrong`, `radii.xl` (20), `colors.border` |
| Title | `typography.h3` (18/600), `colors.text` |
| Body | `typography.bodySmall`, `colors.textMuted` |
| Cancel | Text button, `colors.textMuted` |
| Confirm | `colors.danger` bg (destructive) or `colors.primary` (neutral), ≥48dp |

**Accessibility:** `accessibilityViewIsModal`, focus moves to dialog on open, returns to trigger on close.

---

## 13. Toast

**Purpose:** Brief success/error confirmation (DB: Confirmation Messages — no silent success).

| Property | Value |
|---|---|
| Position | Top, below header |
| Background | `colors.surfaceStrong` |
| Border | `colors.borderStrong` |
| Text | `typography.bodySmall` |
| Icon | ✓ `colors.success` / ✗ `colors.danger` |
| Duration | 2.5s auto-dismiss, swipe to dismiss |
| Animation | Slide-down 200ms (respect reduced-motion) |

---

## 14. ProviderForm / SkillForm (screens)

**ProviderForm:** name, base URL (prefilled per provider), API key (masked input), default model, **Test connection** button (loading → success/error), Save.

**SkillForm:** name, instruction (free text), trigger (schedule / on-new-mail / manual), time (if schedule), daily budget, quiet hours, shadow toggle.

Both use `.field` pattern: label (`label` style, `colors.textMuted`) → input (`colors.surface` bg, `colors.border`, focus `colors.borderPrimary`) → helper text (`caption`, `colors.textSubtle`).

---

## Cross-cutting rules

1. **No emojis as icons** — every icon is SVG (Lucide set), `accessibilityLabel` on icon buttons.
2. **Touch targets** ≥48dp, 8px gaps (DB: Touch Spacing).
3. **Contrast** — text 4.5:1 minimum; `textMuted #94A3B8` on `bg #0B1326` ≈ 7:1 ✓; `textSubtle #64748B` on `bg` ≈ 4.6:1 ✓ (use sparingly for captions only).
4. **Focus** — 2px ring `colors.borderPrimary`, offset 2px (DB: Focus Appearance).
5. **Reduced motion** — disable pulse/typing animation, show static final state (DB: Streaming).
6. **Status** — announce as atomic message, not bare numbers (DB: Contextual Live Badge).
7. **One primary action per screen** (MVP-UI §1).

---

*Component spec complete. Next: screen-by-screen walkthrough (Today → Mail → Agent → Activity → Settings) with exact layouts and states.*
