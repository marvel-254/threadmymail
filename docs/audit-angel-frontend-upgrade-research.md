# Frontend UI Audit & Upgrade Research — ThreadMyMail

**Author:** Angel (slot `01a0e797-04a7-7803-95bf-a5f542fd8371`) — UI/UX Pro Max  
**Task:** `#01a0e7b8-d9ad-72d0-bd81-5ee15f721d9c` Frontend UI Audit & Upgrade Research  
**Mode:** Read-only audit. No code changes.  
**Stack detected:** React 18.2 + react-router-dom 6.22 + Vite 5.1 + Tailwind 4.3.3 (installed, unused) + PWA (`vite-plugin-pwa` 0.17.5)  
**Design DB:** `~/.agents/skills/ui-ux-pro-max` (`python3 scripts/search.py`) — Python 3.14.7  
**Date:** 2026-09-28

---

## 1. Verdict

**Shell is architecturally correct and token-disciplined — but stylistically split and PWA-incomplete.**

The agent-first shell (`AppShell` rail + `AgentStream` primary + `Today`/`Activity`/`Skills`/`Plugins` secondary) correctly retires the 3-pane mailbox metaphor. `index.css` + `app.css` are token-driven (`var(--primary)` / `var(--surface)` / `color-mix`), shell a11y is strong (landmarks, `aria-current`, `aria-hidden` on deco icons, `focus-visible`), and Workbox is security-aware (`NetworkOnly` for `/agent/stream`). The gap is a two-speed frontend: the shell is pristine, while `Landing.jsx` concentrates all inline-style debt (23 `style={{}}` props), font is double-loaded, and the PWA manifest declares icons that do not exist. For 2025–2026, the direction is clear — **AI-Native UI + glassmorphism evolution + not-pure-black dark mode**, with Inter and a semantic purple/indigo token system — already partially present, but not yet codified.

---

## 2. Design System Consistency

### 2.1 Token system — strong foundation

| Layer | Tokens | Evidence |
|---|---|---|
| Light tokens | `--primary #2563EB`, `--primary-dark #1D4ED8`, `--secondary #3B82F6`, `--accent #EA580C`, `--bg #F8FAFC`, `--surface rgba(255,255,255,0.72)`, `--surface-strong rgba(255,255,255,0.92)`, `--text #1E293B`, `--text-muted #475569`, `--text-subtle #94A3B8`, `--border rgba(255,255,255,0.35)`, `--shadow-glass`, `--blur 16px`, `--radius 20px`, `--font-heading Poppins`, `--font-body Open Sans` | `frontend/src/index.css:3-20` |
| Dark tokens | `html.dark` overrides `--bg #0B1120`, `--surface rgba(255,255,255,0.06)`, `--text #F1F5F9`, `--border rgba(255,255,255,0.10)`, etc. | `frontend/src/index.css:23-32` |
| Shell consumption | 100% token via `var(--*)` + `color-mix(in srgb, var(--primary) 12%, transparent)` for tags, rail active state, notices | `frontend/src/styles/app.css:71-73,140-162,372` |
| Glass system | `.glass` / `.glass-strong` → shell, command bar, settings, cards | `frontend/src/index.css:52-69` |

**Strength:** Single source of truth; `app.css` introduces no new color literals beyond intentional semantic states (`#DC2626` danger, `#16A34A` live, `#D97706` warn — own semantic concern, §2.2).

### 2.2 Consistency debt

| Severity | Finding | Evidence |
|---|---|---|
| **Major** | **23 inline `style={{}}` props in `Landing.jsx` — 100% of style debt in one file.** Orbs (`420px #60A5FA`, `360px #A78BFA`), logo flex, theme button padding, headline accent span, hero capability card + inner title/para, pill row, install/footer section. Not themable, not responsive via tokens, recreated per render. | `frontend/src/pages/Landing.jsx:56-57,61,68,86,100-112,145-159` — verified `grep -c "style={{" → 23` |
| **Major** | **Font double-load — identical families via two mechanisms.** | `frontend/src/index.css:1` `@import url('…Poppins+Open Sans…')` **and** `frontend/index.html:12` `<link href="…Poppins+Open Sans…">` — identical weights. One blocks rendering via `@import` even with `preconnect` present. |
| **Minor** | **Hardcoded semantic hexes repeated in `app.css` rather than tokens.** `#DC2626`, `#16A34A`, `#D97706`, `#B45309` × ~29 occurrences — should be `--danger` / `--success` / `--warn`. | `frontend/src/styles/app.css:136-138,153,177,381,404` |
| **Minor** | **Duplicate logo asset.** | `frontend/src/logo.svg` and `frontend/public/logo.svg` identical 749 B — `diff` identical. |
| **Info** | **Body gradients are the only non-token visuals** (`#E0F2FE → #C7D2FE → #EDE9FE` light, `#0B1120 → #1E1B4B → #0F172A` dark) | `frontend/src/index.css:40,48-49` |
| **Info** | **`app.css:3` comment "No new colour literals beyond these" is aspirational** — true inside `app.css` but not inside `Landing.jsx`/`index.css` (`#60A5FA`, `#A78BFA` etc.) | Compare header comment to landing literals |

### 2.3 What "good" should look like (DB target)

| Upgrade | Design DB target | ThreadMyMail today |
|---|---|---|
| Style | **AI-Native UI** (chatbot/conversational, minimal chrome, streaming text, ambient) [DB1] + secondary Glassmorphism [DB2] | AI-Native intent correct (stream is the app); glass present butlanding orbs are ad-hoc, not DB-driven |
| Palette | **AI purple #7C3AED + #A78BFA + cyan #0891B2 on #FAF5FF** (card `#FFFFFF`, border `#DDD6FE`, foreground `#1E1B4B`) [DB1] | Light `#2563EB`/`#3B82F6`/`#EA580C` on `#F8FAFC` — cooler blue/orange, not the recommended purple/cyan. Dark `#0B1120` matches DB dark excellence guidance. |
| Typography | **Inter / Inter** — Modern Dark Cinema, 300/400/500/600/700, tailored to AI dashboards [DB3] | **Poppins (heading) + Open Sans (body)** — still correct but not the DB-recommended single-family precision system. |
| Pattern | **Product Demo + Features** — hero → product video/mockup (center) → feature breakdown → comparison → CTA [DB4] | Landing is Hero + Features + Install — close, but missing the explicit center mockup/demo that justifies glassmorphism. |

**Implication:** Adopting the DB palette/typography is not a redesign — it is a token swap (`--primary #7C3AED`, `--font-heading/body Inter`) plus a hero mockup. That single move eliminates most visual debt.

---

## 3. Responsiveness

| Breakpoint | Landing | Shell |
|---|---|---|
| `<640px` | Collapse heading stack, CTA buttons stack, footer wraps; missing explicit mobile nav treatment for floating `.navbar glass` (0) | `.shell` → single col, `.rail` collapses to bottom bar (tested `@media (max-width: 720px)` in `app.css:626-649`) |
| `641–900` | Container 92%, hero gap reduction | As above — rail still bottom |
| `≥900` | `.hero-grid { 1.1fr 0.9fr; gap: 5rem }` | `main` max 900px reading width; `pane` centered |
| `≥1200` | `max-width 1200px` centering | Same 900px max — consistent |

**Responsive gaps**

| Severity | Finding | Evidence / Fix |
|---|---|---|
| **Minor** | **Floating `navbar glass` (`top: 0` + `glass`) at `393px` viewport loses safe margin** — overlaps safe-area inset without `top-4 left-4 right-4` pattern from DB guidelines. | `frontend/src/index.css:106-110` `.navbar { position: sticky; top: 0 }` — add `top: 0.75rem; margin: 0 0.75rem` at mobile or adopt DB "floating navbar top-4 left-4 right-4" |
| **Minor** | **Orbs use fixed `px` sizes (`420`, `360`)** — overflow at `375px` | `Landing.jsx:56-57` — replace with `%`/`vw` or CSS classes `.orb-a/.orb-b` |
| **Info** | **No container query usage** — not needed at this complexity; `auto-fit minmax(300px,1fr)` cards suffice | `frontend/src/index.css:141` |

---

## 4. Accessibility

### 4.1 Strong baseline (keep)

| Signal | Evidence |
|---|---|
| Landmarks | `<nav aria-label="Primary">`, `<main>`, `<section aria-label="Hero|Features|Install">`, `<section aria-label="Agent stream|Today|...">` each pane, `<footer aria-label="Footer">` — complete | `Landing.jsx:59,79,119,145`, `AppShell.jsx:85`, `AgentStream.jsx:136` |
| Icon buttons named | `aria-label="Toggle theme|Install|Command bar|...`, `aria-current="page"` on active rail, `title` fallback | `AppShell.jsx:96`, `Landing.jsx:69` |
| Decorative hidden | `aria-hidden="true"` on all inline `<path>` icons; `alt=""` on decorative logo | `Landing.jsx:5-25`, `AppShell.jsx:87` |
| Focus visible | `.rail-btn:focus-visible { outline: 2px solid var(--primary) }`, `.todo-check:focus-visible`, `button[data-action]:focus-visible` in artifact TOKENS | `app.css:74,373`, `ArtifactFrame.jsx:49` |
| Reduced motion | `@media (prefers-reduced-motion: reduce) { .reveal/.msg animation: none }` | `index.css:160-162`, `app.css:651-652` |
| Status role | Backend-missing uses `role="status"` | `AgentStream.jsx:155` |

### 4.2 Gaps (ordered)

| # | Severity | Gap | Evidence | Fix (one-liner) |
|---|---|---|---|---|
| A1 | **Major** | **Dialogs are not dialogs.** `CommandBar` / `SettingsPanel` use `<div role="dialog">` inside `<div role="presentation" onClick={onClose}>` with `stopPropagation` — missing `aria-modal="true"`, `aria-labelledby`, focus trap (Tab wrap), return-focus, and shell `inert`/`aria-hidden`. | `CommandBar.jsx:73-78`, `SettingsPanel.jsx:82-87` | Prefer native `<dialog showModal()>` (`::backdrop`, `inert` free) or add `aria-modal`, `aria-labelledby→heading`, focus trap + `document.activeElement` restore |
| A2 | **Minor** | **No `aria-live` for streaming.** Token appends and status pill updates silently for screen readers. | `AgentStream.jsx:136-212`, status pill `<span className="status">` | Add `aria-live="polite" aria-atomic="false"` to stream container; `role="status" aria-live="polite"` to status pill |
| A3 | **Minor** | **Escalation uses `role="alertdialog"` without modal wiring** | `AgentStream.jsx:235` | Pair with focus move to first action on escalation arrival |
| A4 | **Minor** | **`href="#"` logo link** — jumps to top, not home | `Landing.jsx:61` | Change to `href="/"` |
| A5 | **Info** | **No skip link** (relevant once `/app` is gated) | No `href="#main"` | Add `<a href="#main" class="skip-link">` at top of `AppShell`; `main#main` target |

Checklist delta vs WCAG 2.2 (DB & web guidance [W1]):

- [x] Contrast 4.5:1 / 3:1 large / 3:1 UI — shell tokens meet via `#1E293B` on `#F8FAFC` (`#0F172A` is ~15.9:1 on white); DB warns to test glass text at 4.5:1 — `muted #475569` on `surface 0.72` needs manual check on light gradient.
- [x] Focus visible
- [x] `prefers-reduced-motion`
- [ ] Color-not-only-indicator — todo-overdue uses color + `✗`; but tag `tag-warn` relies on amber only (should pair icon).
- [ ] Target size 24×24 — rail 18px icons inside 36px button: passes, but verify composer send (≈28px).

---

## 5. PWA Readiness

### 5.1 Correct by design

| Signal | Evidence |
|---|---|
| `registerType: autoUpdate`, `globPatterns **/*.{js,css,html,ico,png,svg}`, `navigateFallback /index.html` | `frontend/vite.config.ts:7-12,25` |
| Runtime caching is security-aware: `NetworkOnly` for `/v1/agent/stream` (WebSocket never cached) + `NetworkFirst` for `/v1/(emails|todos|activity)` (`maxEntries 200`, `maxAge 300`, `networkTimeout 10`) | `vite.config.ts:27-44` |
| Build precaches `logo.svg`, `index.html`, `assets/*.js/*.css`, `manifest`, `registerSW.js` | `frontend/dist/` contents |
| `scope /`, `start_url /`, `display standalone` — correct install scope | `vite.config.ts:17-20` |

### 5.2 Blockers (fail Lighthouse + break install UX)

| # | Severity | Finding | Evidence |
|---|---|---|---|
| P1 | **Blocker** | **Declared icons do not exist.** Manifest requires `pwa-192x192.png` + `pwa-512x512.png` but neither exists in `public/` nor `dist/`. | `vite.config.ts:19-21` + `frontend/dist/manifest.webmanifest` icons array vs `ls frontend/public/` → only `logo.svg` |
| P2 | **Major** | **`includeAssets` references non-existent `favicon.ico` + `apple-touch-icon.png`** → Workbox precache warns + 404s | `vite.config.ts:11` |
| P3 | **Minor** | **Theme-color drift.** `index.html:8` `meta theme-color #2563EB` (`--primary`) vs `vite.config.ts:15` / `dist/manifest.webmanifest` `theme_color #3b82f6` (lighter). `background_color #ffffff` while `--bg` is `#F8FAFC` (light) / `#0B1120` (dark). | `index.html:8`, `vite.config.ts:15`, `dist/manifest.webmanifest` |
| P4 | **Minor** | **No `shortcuts`, `screenshots`, `categories`** in manifest — missed richer install UI | `dist/manifest.webmanifest` (6 keys only) |

**Fix order:** Generate `192` + `512` PNGs from `logo.svg` (e.g. `sharp`), add `favicon.ico` + `apple-touch-icon.png` or remove from `includeAssets`, unify `theme_color` to `#2563EB` (or DB-recommended `#7C3AED` if the token swap lands).

---

## 6. 2025–2026 Upgrade Research

All recommendations cite the DB search (method: `python3 ~/.agents/skills/ui-ux-pro-max/scripts/search.py`) or the web source shown.

### 6.1 AI-Native UI + glassmorphism evolution (DB truth)

| Source | Finding | ThreadMyMail mapping |
|---|---|---|
| **DB — design system** `—design-system -p ThreadMyMail "AI email assistant productivity minimal dark glassmorphism"` → **Style: AI-Native UI** — conversational, minimal chrome, streaming text, ambient; supports light+dark [DB1] | Primary shell style. `AgentStream` streaming tokens + `ArtifactFrame` context cards + minimal chrome already match. Avoid heavy chrome / slow response feedback — matches `AgentStream.jsx` intent. |
| **DB — style** `"minimal glassmorphism dark"` → `minimalism-and-swiss-style` (grid 12-16, sharp shadows, low complexity) [DB5] | Minimalism is the correct *secondary* for the marketing surface, not the conversation surface — DB says to pair AI-Native + Glassmorphism for chat, Minimalism + Swiss for landing. |
| **DB — landing** `"product demo features"` → **Product Demo + Features** — `Hero > Product video/mockup (center) > Feature breakdown > Comparison > CTA`; optimization: only use demo when static media is worse, provide captions/transcript/controls, no autoplay under reduced motion [DB4] | Current landing omits the center mockup/demo — the highest-ROI upgrade. A static mockup of the agent stream wins over autoplay video here (reduced-motion default). |
| **DB — ux** `"AI email assistant accessibility streaming chat"` → **Streaming: stream token by token** (no 10s spinner), **Disclaimer: label AI content**, **Feedback: thumbs/regenerate** [DB6] | Token streaming already exists (`appendToken`); add visible "AI-generated" label and a feedback affordance (e.g. thumbs row in `msg-agent`) to meet the DB checklist. |
| **Web — Lucky Graphics 2026** [W1] **Advanced glassmorphism** → variable blur, color absorption, frosted edges, chromatic shifts; guard with contrast tests + performance fallbacks | ThreadMyMail uses fixed `blur 16px` + `--border rgba(255,255,255,0.35)` — correct baseline; variable blur / frosted edges are the evolution (reserve for hero card only, not the whole shell). |
| **Web — Lucky Graphics 2026** [W1] **Dark Mode Excellence** → background *not* pure black (`Gray-900` range), off-white text, slightly desaturated accents, subtle/no shadows in dark | `html.dark --bg #0B1120` + `--surface rgba(...0.06)` already satisfies ("not pure black"). Keep; warn that DB palette `#1E1B4B` as foreground in light mode needs verification on glass surfaces. |
| **Web — Lucky Graphics 2026** [W1] **Bento grids** → asymmetric card-based, `gap 16-32`, `radius 16-24`, subtle hover | `cards { gap 1.5rem; card radius 20px via --radius }` already bento-adjacent; widen gaps to `20-28px` at desktop to fully match the 2026 scale. |
| **Web — Lucky Graphics 2026** [W1] **Micro-interactions** → button `150-200ms`, card `200-300ms`, toggle `200ms`, skeleton shimmer | Shell already uses `160-200ms` transitions — inside the target range. Do not add heavier spring animations. |
| **Web — Lucky Graphics 2026** [W1] **Component & typography 2026** → button hierarchy (primary/secondary/tertiary/destructive/ghost), card patterns (content/stat/profile/action/feature), Inter / Satoshi / JetBrains Mono | Mail/threading/productivity apps should expose *secondary* and *destructive* explicitly — ThreadMyMail only uses `btn-primary` + `btn-ghost` today. |

### 6.2 Mail / threading / productivity — what to borrow (not clone)

No DB entry exists for "email client" as a product; the closest analogues are:

| Analogue | Pattern worth borrowing | Why for ThreadMyMail |
|---|---|---|
| **Linear** — keyboard-centric productivity (DB-adjacent per search provenance `_LINEAR_`) | `⌘K` command palette + rail navigation + `E` done / `S` snooze / `P` pin shortcuts | `CommandBar` + `useHotkey('mod+k')` already present — extend with single-key pane actions once inbox-accessible (not before auth). |
| **Superhuman / Shortwave** — mail minimal + AI triage | Thread list with AI briefing chips + density toggle (comfortable/compact) | `TodayPane` + `AgentStream` artifacts already do briefings; add `density` variant (`--density 7` in DB dials) for power users later. |
| **Notion AI** — ambient assistant inside doc | Artifact frame as projection (read-only to Postgres truth) with fixed-verb bindings | Matches `ArtifactFrame.jsx` sandboxed iframe (`allow-scripts` only) + `BINDING_VERBS` allowlist — keep and harden before extending. |
| **Figma/Frama pattern [W1]** | Sentient UI — predictive layout shifts based on task | DB warns to reserve for dashboard analytics views; do not apply to the conversational stream. |

**Non-advice:** Do not rebuild as a 3-pane Gmail clone — ARCHITECTURE invariant: "email is a capability the agent *has*, not pages you navigate to" (`agent.md §0`). The upgraded path is **thread chips + briefing cards + command bar**, not a heavier chrome.

---

## 7. Color / Typography / Component Patterns — Concrete Tokens

### 7.1 Color system (DB target → current → proposal)

**DB target (AI purple + cyan interactions) [DB1]:**

```
--color-primary        #7C3AED  (--color-ring same)
--color-on-primary     #FFFFFF
--color-secondary      #A78BFA
--color-on-secondary   #0F172A
--color-accent         #0891B2  (CTA/active)
--color-on-accent      #000000
--color-background     #FAF5FF
--color-foreground     #1E1B4B
--color-card           #FFFFFF
--color-muted          #ECEEF9
--color-muted-fg       #475569
--color-border         #DDD6FE
--color-destructive    #DC2626
```

**Current (live):** `--primary #2563EB` (bluer), `--secondary #3B82F6`, `--accent #EA580C` (orange — not AI-cyan), `--bg #F8FAFC`, `--border rgba(255,255,255,0.35)`.

**Proposal (minimal, non-breaking):** Keep current for production; introduce the DB palette behind a `theme: 'tmm-v2'` flag on the agent shell only. The change is a 7-line `:root` swap + no component renames — it immediately unlocks the Lucky Graphics dark excellence note [W1] where "accent slightly desaturated in dark" maps cleanly to `#A78BFA → #8B7CF0`.

- Semantic tokens to add in both palettes: `--danger #DC2626`, `--warn #D97706`, `--success #16A34A`, `--warn-bg #FFFBEB`, `--danger-bg #FEF2F2` (replaces 29 literal occurrences in `app.css`).

**Gradient body fallback [W1]:** Keep current gradients as the one allowed non-token surface, or tokenize as `--bg-gradient` / `--bg-gradient-dark` to satisfy `r-reasearch-team-findings.md §2.3`.

### 7.2 Typography

| DB recommendation | Current | Upgrade path |
|---|---|---|
| **Modern Dark Cinema — Inter 300/400/500/600/700** — single-family precision (`Display 48pt 700 -1.5 tracking; H1 32pt / H2 24pt 600; body 16pt 400; labels 500 uppercase +1.2 tracking**) [DB3] | `Poppins 400/500/600/700` headings + `Open Sans 300..800` body — two families, two imports | Swap `@import`/`link` to `Inter 300;400;500;600;700` (single family). Map `h1 clamp(2.5rem,6vw,4rem) weight 700` + `h2 clamp(1.8rem,4vw,2.6rem) 600` unchanged — only the family changes. Keep `ui-monospace` for `mono` / SHAs. |
| DB typography scale [W1] — `Display 48-72, H1 32-40, H2 24-28, H3 20-24, Body 16-18, Small 12-14` | Shell matches: `h1 40-64, h2 28.8-41.6, body 16, small 13.6` | Landing `h2` ("Capabilities, not pages") is slightly oversized vs shell — tighten to `1.6rem 600` for app/marketing hierarchy alignment. |
| Tailwind config | Not configured | If Inter lands: `fontFamily: { sans: ['Inter','sans-serif'] }` [DB3] |

### 7.3 Components (ready-to-apply, zero dependency additions)

| Component | Current | 2026 pattern [W1] | Change |
|---|---|---|---|
| Buttons | `btn` + `.btn-primary` / `.btn-ghost` only | Hierarchy: primary / secondary / tertiary / destructive / ghost | Add `.btn-secondary` (outline) + `.btn-destructive` (`#DC2626`) — both token-driven. Document when each is warranted (audit §5 drift note). |
| Cards | `.card glass` + `.card-icon 48px 14px radius` | Content/stat/profile/action/feature cards; `radius 16-24`, `gap 16-32` | Bump `card radius` to `20-24` at desktop; `cards gap 1.5rem → 1.75rem` — already inside DB `--radius 20px`. |
| Inputs | `.field input/textarea` + focus border | States: default / focused (ring) / filled / error / disabled / success | Add `error` state (`border --danger`, `helper --danger`) + `ring` on focus (`outline: 2px solid color-mix(in srgb, var(--primary) 30%, transparent)`). |
| Chips/tags | `.chip`, `.tag color-mix 12%` | Functional colors, clear hierarchy | Extract Landing pills to `.pill glass` (pass `reduced-motion` fix too). |
| Dialogs | `role="dialog"` + backdrop `role="presentation"` | Native `<dialog showModal()>`: `aria-modal`, focus trap, Escape, `::backdrop`, `inert` [W1 a11y] | Migrate `CommandBar`/`SettingsPanel` to `<dialog>` — highest a11y ROI, removes A1. |
| Live regions | None for stream/status | `aria-live="polite"` for streaming tokens | Add `aria-live="polite"` to stream container + `role="status"` to status pill — second-highest ROI. |
| Empty states | Per-pane `muted` text; stream has 4 suggestion chips | Contextual empty state with suggestion chips + feedback affordance [DB6] | Keep; add feedback row (thumbs/regenerate) once artifact verb budget allows. |

---

## 8. Findings Summary — Prioritized Fix Order

| # | Area | Action | Severity | Source |
|---|---|---|---|---|
| 1 | PWA | Generate `pwa-192x192.png` + `pwa-512x512.png` from `logo.svg` (`sharp`/`svgexport`), add `favicon.ico` + `apple-touch-icon.png` or remove from `includeAssets` | **Blocker** | `vite.config.ts:11,19-21` + findings §5.2 P1/P2 |
| 2 | Tokens | Remove font double-load: delete `index.css:1` `@import`, keep `index.html:12` `<link>` + `preconnect` [W1 perf] | **Major** | `index.css:1` vs `index.html:10-12` |
| 3 | Tokens | Extract `Landing.jsx` 23 inline `style={{}}` → CSS classes (`.hero-orbs`, `.hero-card`, `.pill`, `.install-section`); extract orb `width/height/background/opacity` to static classes | **Major** | `Landing.jsx:56-57,100-112,145-159` |
| 4 | PWA | Unify `theme_color` to `#2563EB` (or `#7C3AED` if DB palette adopted) + align `background_color` to `#F8FAFC` | **Minor** | `index.html:8` vs `vite.config.ts:15` |
| 5 | Tokens | Tokenize semantic colors (`--danger`, `--warn`, `--success`, `--warn-bg`, `--danger-bg`) and replace literals | **Minor** | `app.css:136-138,381` (29 literals) |
| 6 | A11y | Migrate `CommandBar`/`SettingsPanel` to native `<dialog>`; add `aria-live` to stream + status | **Major / Minor** | §4.2 A1, A2 |
| 7 | Build | Decide Tailwind — remove `tailwindcss`/`autoprefixer`/`postcss` deps if unused, or adopt with `postcss.config` + `tailwind.config` | **Minor** | `package.json:21-22` present, no config or `@tailwind` directives |
| 8 | Build | Add `ErrorBoundary` at `AppShell.main` + `AgentStream`; add `React.lazy` + `Suspense` for `Landing` vs shell code-split | **Minor** | `dist/assets/index-Bp_xneX-.js 213KB` single chunk; no `ErrorBoundary` |
| 9 | A11y | Color-not-only indicator for `tag-warn` (add icon), target-size audit for composer | **Minor** | §4.2 checklist |
| 10 | PWA+DX | Commit generated PWA icons, `package-lock.json` (untracked 224 KB), add `aria-live`, add skip link once `/app` gate lands | **Info** | `git ls-files --others` |

---

## 9. Risks If Not Addressed

1. **Install still looks broken** — missing manifest icons → generic/blank install icon on Android, Lighthouse PWA fail — erodes the "Install App" CTA that the landing centers.
2. **Landing debt compounds** — every marketing tweak adds more inline styles, divorcing the landing from the token system and making the DB palette adoption a rewrite instead of a swap.
3. **Fragile shell + no split** — single `213 KB` chunk + no `ErrorBoundary` means one pane regression blanks the app and every landing visitor pays the full authenticated cost.

---

## 10. DB & Stack Notes (supplemental domain runs)

| Run | Command | Result |
|---|---|---|
| Design system | `search.py "AI email assistant productivity minimal dark glassmorphism" --design-system -p "ThreadMyMail"` | **Style AI-Native UI**, **Pattern Product Demo + Features**, **Colors #7C3AED/#A78BFA/#0891B2 on #FAF5FF**, **Inter 300-700**, dark+supported [DB1] |
| Product | `"AI assistant productivity" --domain product -n 3` | Productivity Tool (Flat + Micro) + **AI/Chatbot Platform (AI-Native + Swiss / Zero Interface, Glassmorphism)** [DB2] |
| Style | `"minimal glassmorphism dark" --domain style` | `minimalism-and-swiss-style` — grid-based, high contrast, `gap:2rem`, minimal decorations [DB5] |
| Typography | `"dark technical premium" / "Inter clean premium" --domain typography` | **Modern Dark Cinema (Inter / Inter)** — precision single-family system [DB3] |
| Color | `"purple indigo dark premium" --domain color` | Automotive (`#1E293B`), Luxury (`#1C1917`/`#A16207`), Sleep (`#4338CA`/`#6366F1`) — not DB target, consistent: dark + action accent pattern [DB7] |
| Landing | `"product demo features" --domain landing` | **Product Demo + Features** — `Hero > video/mockup center > Feature breakdown > Comparison > CTA` [DB4] |
| UX | `"AI email assistant accessibility streaming chat" --domain ux` | **Streaming** (token-by-token), **Disclaimer** (label AI), **Feedback** (thumbs/regenerate) [DB6] |
| Stack `react` | `"AI dashboard productivity" / "dashboard productivity" --stack react` | No direct hits — DB `stacks/react.csv` has no dedicated AI-dashboard entry (explicitly noted per prompt requirements). Fallback: React+Vite+Tailwind defaults [DB8/DB9] |

---

## 11. Sources (every DB + web + file claim cited)

**Design DB (`~/.agents/skills/ui-ux-pro-max`):**

- [DB1] `--design-system -p "ThreadMyMail"` query `"AI email assistant productivity minimal dark glassmorphism"` — Style AI-Native UI, Colors `#7C3AED/#A78BFA/#0891B2/#FAF5FF/#1E1B4B`, Typography Inter Inter, Pattern Product Demo + Features.
- [DB2] `--domain product` query `"AI assistant productivity"` — `products.csv` Results 1–2 (Productivity Tool; AI/Chatbot Platform keywords `ai, automation, chatbot, ml, platform`).
- [DB3] `--domain typography` queries `"dark technical premium"` / `"Inter clean premium"` — `typography.csv` Result 1 Modern Dark Cinema (Inter System) `Inter 300;400;500;600;700`.
- [DB4] `--domain landing` query `"product demo features"` — `landing.csv` `product-demo-features` section order + conversion optimization transcript/caption note.
- [DB5] `--domain style` query `"minimal glassmorphism dark"` — `styles.csv` `minimalism-and-swiss-style`.
- [DB6] `--domain ux` query `"AI email assistant accessibility streaming chat"` — `ux-guidelines.csv` Streaming / Disclaimer / Feedback Loop (Severity Medium/High/Low).
- [DB7] `--domain color` query `"purple indigo dark premium"` — `colors.csv` Results 1–3.
- [DB8] `--stack react` query `"AI dashboard productivity"` — `stacks/react.csv` Found 0, explicit no-match guidance quoted.
- [DB9] `--stack react` query `"dashboard productivity"` — `stacks/react.csv` Found 0.

**Web:**

- [W1] Lucky Graphics — *UI Design Trends 2026* (Julian Hayes, 2026-02-05, https://lucky.graphics/learn/ui-design-trends-2026/) — Advanced glassmorphism (variable blur / color absorption / frosted edges / chromatic shifts), Dark Mode Excellence (not pure black), Bento grids (`gap 16-32`, `radius 16-24`), Micro-interactions `150-300ms`, Typography 2026 (Inter / Satoshi / JetBrains Mono), Color Systems semantic tokens, Accessibility WCAG 2.2, Core Web Vitals.
- [W2] Framer / Stan Vision / Grotto / Intuitia — corroborating 2026 roundups (identified in search phase, not individually deep-fetched; Lucky Graphics is the primary verifiable source — others available on request).

**Repo files (read-only at audit time):**

- `frontend/src/index.css:1-69` — `@import`, `:root` tokens, `html.dark`, `.glass`, `.orb`, typography, `prefers-reduced-motion`.
- `frontend/src/styles/app.css:1-653` — shell, rail, panes, stream, artifact, todos, sheets, kill switch, command bar, auth, responsive, `prefers-reduced-motion`.
- `frontend/src/pages/Landing.jsx:1-178` — inline orbs, nav, hero, features, install, footer; `aria-*` coverage; 23 `style={{}}`.
- `frontend/src/app/AppShell.jsx` — `VIEWS` rail, `aria-current`, `CommandBar`/`SettingsPanel` dialog pattern.
- `frontend/index.html:8-12` — `theme-color #2563EB`, `preconnect`, `fonts.googleapis`.
- `frontend/vite.config.ts` — `VitePWA` `includeAssets`, `manifest` icons, `runtimeCaching` `NetworkOnly` / `NetworkFirst`, proxy `WORKER_DEV_URL`.
- `frontend/dist/manifest.webmanifest` — `theme_color #3b82f6`, icons `pwa-192x192.png`/`pwa-512x512.png`.
- `frontend/package.json` — `react 18.2`, `vite 5.1`, `tailwindcss 4.3.3` + `autoprefixer`/`postcss` present.
- `docs/r-reasearch-team-findings.md` — prior Frontend + Backend audits (2026-09-28); §2.3 body-gradient / ThemeContext / `<dialog>` / skip link supplement acknowledged as peer review.

---

*No files modified at implementation level. Report is audit + research only per task. Code changes (if approved) land as a follow-up PR from the §8 fix order.*
