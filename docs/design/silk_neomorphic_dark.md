---
name: Silk Neomorphic Dark
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#c7c4d7'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#908fa0'
  outline-variant: '#464554'
  surface-tint: '#c0c1ff'
  primary: '#c0c1ff'
  on-primary: '#1000a9'
  primary-container: '#8083ff'
  on-primary-container: '#0d0096'
  inverse-primary: '#494bd6'
  secondary: '#bdc2ff'
  on-secondary: '#131e8c'
  secondary-container: '#2f3aa3'
  on-secondary-container: '#a8afff'
  tertiary: '#7bd0ff'
  on-tertiary: '#00354a'
  tertiary-container: '#009bd1'
  on-tertiary-container: '#002d40'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#e0e0ff'
  secondary-fixed-dim: '#bdc2ff'
  on-secondary-fixed: '#000767'
  on-secondary-fixed-variant: '#2f3aa3'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-mobile: 0.75rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system expresses a refined, tactile dark-mode interface built for executive-grade email management and AI-assisted triage. Its identity sits at the intersection of quiet luxury and computational precision. The interface must never feel harsh, purely flat, or neon-heavy; instead, it adopts an organic, sculpted surface aesthetic where controls feel extruded from a unified matte slate medium.

The target audience comprises power communicators, founders, and knowledge workers who spend hours handling high-leverage communications and require an environment that eliminates optical fatigue while conferring spatial clarity. The emotional atmosphere is calm, subterranean, focused, and tactile.

The design movement merges **Dark Neomorphism** with **Silk Glass Elements**:
- Elements appear pushed out from or recessed directly into rich charcoal slate foundations.
- Micro-light catches the top-left edges using razor-thin, whisper-soft white specular highlights (`rgba(255, 255, 255, 0.05)`).
- Opposite borders fall into deep, diffused dark absorption (`rgba(0, 0, 0, 0.6)`).
- Interactive states introduce atmospheric violet-indigo luminescence, mirroring the behavior of darkroom instrument lights rather than conventional web app chrome.

## Colors

The palette relies on a deep, stratified dark continuum accented by spectral indigo-violet for proactive intelligence states and Gmail-inspired tonal markers.

### Palette Architecture
- **Base Canvas (`neutral_color_hex` - #0f172a):** Deep charcoal slate backdrop providing zero-glare comfort.
- **Surface Extruded Base (#172033):** Middle tier used for standard containers, cards, and floating list panes.
- **Surface Inset/Recessed (#0b1120):** Used for search bars, text input areas, and read email rows.
- **Primary Accent (`primary_color_hex` - #6366f1):** Deep electric indigo for affirmative actions, primary AI actions, and active indicators.
- **Secondary Accent (`secondary_color_hex` - #818cf8):** Soft luminous periwinkle-violet for thread badges, focus rings, and secondary pill states.
- **Tertiary Accent (`tertiary_color_hex` - #38bdf8):** Atmospheric cyan for email categorization, attachment links, and sync status pings.

### Monochromatic Text & Chrome
- **Text Emphasized:** `#f1f5f9` (Slate 100) — Thread subjects, direct user text, primary counts.
- **Text Reading/Standard:** `#cbd5e1` (Slate 300) — Email body previews, metadata, timestamps.
- **Text De-emphasized:** `#94a3b8` (Slate 400) — Thread snippets, category markers, keyboard shortcuts.
- **Text Muted/Disabled:** `#475569` (Slate 600) — Dividers, inactive icons, placeholder text.

### Neomorphic Light Source Mechanics
- **Upper Specular Glint:** `rgba(255, 255, 255, 0.045)` to `rgba(255, 255, 255, 0.08)`.
- **Lower Umbra Basin:** `rgba(0, 0, 0, 0.45)` to `rgba(0, 0, 0, 0.70)`.

## Typography

The typographical pairing counterbalances technical precision with soft, humane readability.

- **Display & Headings:** `Space Grotesk` introduces structured geometric rhythm to mailbox metrics, AI thread summaries, and pane headers, projecting modern analytical power without becoming harsh.
- **Body & Data Chrome:** `Plus Jakarta Sans` handles email threads, draft bodies, metadata tags, and action items. Its open letterforms and rounded geometry avoid rendering bottlenecks on OLED and dark displays, preventing halo vibrations around high-contrast body text.

### Typographic Rules
- Large thread summaries use `body-lg` with a relaxed 26px line-height to guarantee effortless speed-reading.
- Sender names and unread statuses take `title-md` with `font-weight: 600` in Slate 100.
- Timestamps, keyboard cues, and secondary telemetry tags employ `label-sm` with slight uppercase tracking (`0.03em`) in Slate 400.

## Layout & Spacing

The dashboard employs a three-pane fluid column system with explicit gutter isolation to allow tactile extruded shadows room to breathe without clipping into adjacent panels.

### Dashboard Grid Hierarchy
1. **Utility Navigation Sidebar (64px to 240px collapsable):** Rigid anchor for mail folders, automated labels, and status filters.
2. **Thread Stream Feed (380px to 480px flexible):** High-density vertical stack with inset gaps separating communication chunks.
3. **Active Workstation Pane (1fr flex, min 560px):** Expansive reading and drafting zone containing AI reply synthesis modules and full thread histories.

### Adaptive Behavior
- **Desktop (1280px+):** All 3 panes co-exist simultaneously. Side margins fixed at `margin` (2rem); pane gutters set to `gutter` (1.5rem).
- **Tablet / Laptop (768px – 1279px):** Navigation snaps to an extruded icon rail (64px). Thread feed and workspace divide the remainder 40% / 60%.
- **Mobile (Below 768px):** Single-surface view model. Thread view transitions horizontally into the reading card via sliding extrusion. Canvas margin contracts to `margin-mobile` (1rem); component gaps default to `gutter-mobile` (0.75rem).

## Elevation & Depth

Visual hierarchy does not use flat overlays or sharp border boundaries. Depth is engineered exclusively through dual-vector directional lighting and tonal density. The virtual light source originates consistently from the **top-left (-135°)**.

### The 4 Tactile Tiers

1. **Recessed / Inset Wells (Depth -1):**
   - *Application:* Search boxes, filter wells, unread message rows, code snippets, composer entry blocks.
   - *Construction:* Surface color `#0e1626`.
   - *Shadow:* `inset 3px 3px 6px rgba(0, 0, 0, 0.65), inset -2px -2px 5px rgba(255, 255, 255, 0.035)`.
   - *Perception:* Carved directly into the canvas.

2. **Base Plane (Depth 0):**
   - *Application:* Main window foundation and non-clickable structural backings.
   - *Construction:* Surface color `#0f172a`. Flat texture, zero drop shadow.

3. **Soft Extrusion (Depth +1):**
   - *Application:* Mail cards, unread priority pills, panel headers, standard buttons.
   - *Construction:* Surface color `#172033`.
   - *Shadow:* `4px 4px 10px rgba(0, 0, 0, 0.50), -3px -3px 8px rgba(255, 255, 255, 0.04)`.
   - *Perception:* Elevated, rounded volume emerging from the slate.

4. **Floating Action & Active Focus (Depth +2):**
   - *Application:* Floating AI composer widget, active dropdowns, hovered mail cards, modal assistants.
   - *Construction:* Surface color `#1c263c`.
   - *Shadow:* `8px 12px 24px rgba(0, 0, 0, 0.65), -4px -4px 12px rgba(255, 255, 255, 0.05)`.
   - *Aura Glow:* Accent-influenced active elements add an outer atmospheric corona: `0 0 20px rgba(99, 102, 241, 0.22)`.

## Shapes

The roundedness token level is **2** (base radius: `0.5rem` / 8px; `rounded-lg`: `1rem` / 16px; `rounded-xl`: `1.5rem` / 24px).

Neomorphism requires gentle boundary curves to render ambient light falloff realistically; severe 90-degree corners destroy the illusion of sculpted material.

- **Micro elements (Badges, check markers, inline tags):** `rounded-md` (6px).
- **Buttons, input containers, individual message cards:** `rounded-lg` (16px).
- **Main workspace containers, floating side sheets, composer dialogs:** `rounded-xl` (24px).
- **Pill controls (Filter toggles, quick action prompts, status chips):** Fully circular / pill (`9999px`).

## Components

### Buttons
- **Primary / AI Action Button:**
  - *Rest:* Extruded `#6366f1` gradient to `#4f46e5` with highlight `inset 1px 1px 1px rgba(255,255,255,0.25)` and drop shadow `4px 4px 12px rgba(0,0,0,0.4), 0 0 16px rgba(99,102,241,0.3)`. Text is pure white (`#ffffff`).
  - *Hover:* Glow widens to `0 0 24px rgba(129,140,248,0.5)`.
  - *Pressed / Active:* Depressed well effect: `inset 3px 3px 6px rgba(0,0,0,0.4), inset -1px -1px 3px rgba(255,255,255,0.1)`.
- **Secondary / Ghost Button:**
  - *Rest:* Slate surface `#172033` with dual shadows (`3px 3px 8px rgba(0,0,0,0.5), -2px -2px 6px rgba(255,255,255,0.04)`). Text in `#cbd5e1`.
  - *Hover:* Text shifts to `#f1f5f9`; top specular brightens to `rgba(255,255,255,0.07)`.

### Input Fields & Search
- Recessed inset container `#0b1120`.
- Inset shadows: `inset 2px 2px 5px rgba(0,0,0,0.7), inset -1px -1px 3px rgba(255,255,255,0.03)`.
- Placeholder text in `#475569`; active input text in `#f1f5f9`.
- *Focus State:* Retains the recessed well while projecting an outer ring glow of `0 0 0 2px rgba(99, 102, 241, 0.45)`.

### Chips & Filter Pills
- Fully rounded pill geometry (`9999px`).
- *Inactive:* Surface `#172033` with micro-extrusion (`2px 2px 5px rgba(0,0,0,0.4), -1px -1px 3px rgba(255,255,255,0.03)`).
- *Active / Selected:* Recessed well with violet accent text (`#818cf8`) and faint interior glow: `inset 2px 2px 4px rgba(0,0,0,0.6), 0 0 10px rgba(99,102,241,0.15)`.

### Thread List Items
- Stacked within the thread pane with `space-sm` separation.
- *Unread Row:* Elevated surface (`#1c263c`) with soft extruded shadow and a left-aligned vertical micro-bar glowing in `#818cf8`.
- *Read Row:* Flattens down to canvas grade (`#0f172a`) with subtle inner borders, reducing visual competition.
- *Hover Row:* Translates upward by 1px with enhanced shadow depth (`5px 6px 14px rgba(0,0,0,0.55)`).

### Checkboxes & Radio Controls
- Base: 18x18px square with `rounded-md` (4px).
- Recessed well in default state: `inset 2px 2px 4px rgba(0,0,0,0.7)`.
- *Checked State:* Inset pops out into an extruded accent pebble colored `#6366f1` housing a white check glyph.

### Cards & Assistant Modules (ThreadMyMail Workspace)
- **AI Summary Card:**
  - Distinctive extruded surface container `#172033` with a specialized gradient wash across the top edge (`linear-gradient(90deg, rgba(99,102,241,0.2) 0%, transparent 100%)`).
  - Subtle `1px` translucent top highlight border `rgba(255, 255, 255, 0.06)`.
  - Action tags (e.g., "Draft Reply", "Extract Dates") styled as micro-pills hovering above the card plane.