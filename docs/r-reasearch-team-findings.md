# Backend & Architecture Audit — ThreadMyMail
**Auditor:** Alfred (slot 01a0e70b-bce5-7541-b8da-ad9e99d53032)  
**Task:** #01a0e72c-3c3f-73d0-a9fe-2b6877437d3e  
**Status:** Read-only audit, NO files modified  
**Date:** 2026-09-28

---

## Verdict

**Architecture is sound, implementation is severely incomplete, legacy backend is dead weight, and the gap between docs and reality is the single biggest risk to UI upgrades.**

The ARCHITECTURE.md (docs/archive v1, superseded by docs/ v2) defines a coherent Cloudflare-native design (Workers + Durable Objects + Neon + D1). The apps/worker/ code matches the design for the agent loop (`agent/durable.ts`), tool registry (`tools/registry.ts`), D1 body-store (`storage/bodystore.ts`), and REST surface (`http/routes.ts`). **But large swaths of the documented API — email, calendar, plugins, web-fetch — have no backend implementation.** The frontend (`frontend/src/lib/api.js`) declares endpoints (`/emails`, `/cal/events`, `/plugins`) that return 501 / 404 in reality.

---

## 1. Structural Gaps (Blocker → Major)

| Severity | Finding | Evidence | Impact on UI / Features |
|---|---|---|---|
| **Blocker** | **Legacy `backend/` Python FastAPI is superseded but not removed.** `backend/app.py`, `database.py`, `models.py`, `auth.py`, `schemas.py` describe the old Render-based architecture (IMAP, APScheduler, PostgreSQL without pgvector). `README.md` explicitly says: "Implementation has not started — the Python backend in `backend/` is superseded scaffolding, not part of the build." Yet it remains in repo, with `requirements.txt` listing `fastapi`, `uvicorn`, `APScheduler`, `redis`, `boto3`. | `backend/app.py` (line count 45), `README.md` §Status | Confuses new contributors; CI pipeline (`.github/workflows/ci-cd.yml` — Python) will break. Must delete or archive. |
| **Major** | **Email/calendar/web tool implementations missing from worker.** `APP.md` §8–11 document `/emails/*`, `/calendar/*`, `/plugins/*`. Only `tools/` has `todo.ts`, `memory.ts`, `meta.ts`. No `email.ts`, `calendar.ts`, `web.ts`, `plugin.ts`. `routes.ts` implements `/todos`, `/memories`, `/skills`, `/settings`, `/activity`. | `ls apps/worker/src/tools/` (only 5 .ts files vs 17 tools documented) | UI can show the agent shell, but it cannot read Gmail, book calendar events, or install plugins. Phase 2 ("It sees and acts") is blocked. |
| **Major** | **Google OAuth endpoint missing in worker.** `GOOGLE_OAUTH.md` defines `/auth/google`, `/auth/google/callback`, `/auth/me`. `routes.ts` has no auth section — it uses a hardcoded `DEV_USER_ID = '0000...'`. `wrangler.jsonc` has `GOOGLE_REDIRECT_URI` set to localhost only. | `routes.ts` line 43–46; `wrangler.jsonc` `vars` | Login flow impossible; agent runs cannot associate to a real user. All DB writes go to a fake UUID. |
| **Major** | **Agent loop exists but has no model access.** `agent/model.ts` exists; `agent/loop.ts` implements the tool-execution loop (`executeTool`, `buildSystemPrompt`). But `wrangler.jsonc` has NO `OPENROUTER_API_KEY` secret set, and `index.ts` checks `has_model_key: Boolean(env.OPENROUTER_API_KEY)`. | `wrangler.jsonc`; `src/index.ts` health endpoint | Agent can receive WebSocket messages but cannot generate completions — runs will emit `error` with `INTERNAL`. |
| **Major** | **BodyStore (D1) verified working; Hyperdrive configs registered but unverified.** `bodystore.ts` implements chunked writes (1 MB chunks) and 2.5 MB round-trip. `wrangler.jsonc` binds `DB` (cached) and `DB_FRESH` (cache-disabled) Hyperdrive IDs. No test confirms both connections resolve. | `bodystore.ts` `put()` / `get()`; `wrangler.jsonc` `hyperdrive` array | Read-after-write correctness (required by ARCHITECTURE §6) is unverified. If `DB` serves stale reads, todo updates vanish from the UI after refresh. |
| **Minor** | **Phase 0 spike passed (40M iterations) — DO CPU budget confirmed viable.** `ARCHITECTURE.md` §11 records the result. Both cron triggers (`*/5`, `*/15`) fire (`ok: true`). | `ARCHITECTURE.md` table §11.1; `IMPLEMENTATION_SUMMARY.md` | Architecture gate cleared. No code change needed. |
| **Minor** | **Kill switch dual-write (DO + Postgres) implemented correctly.** `durable.ts` reads `kill_switch` from DO storage AND from `users.prefs` (`persistedKillSwitch`). Earlier version wrote only to Postgres — fixed. | `durable.ts` lines 195–210; `routes.ts` kill-switch handler | Safety control cannot disagree with itself. Good design. |
| **Minor** | **Artifact binding protocol documented but only partially implemented.** `BINDING_VERBS` in `frontend/src/lib/api.js` lists 9 verbs. `VERB_ROUTES` implements 7; `event.rsvp` throws `NOT_IMPLEMENTED` (Phase 5). `routes.ts` lacks `/cal/events` endpoint entirely. | `frontend/src/lib/api.js` lines 230–260 | Artifact frames can tick todos but cannot interact with calendar until Phase 5. |
| **Minor** | **Workflows directory exists but is empty.** `apps/worker/src/workflows/` has no source files. Phase 3 (scheduled skills, durable runs) needs this. | `ls apps/worker/src/workflows/` (empty) | Morning briefing / cron-triggered skills impossible. |
| **Minor** | **Plugin loader / loader directory exists but unimplemented.** `plugins/` directory at repo root (gitignored). `routes.ts` has `/plugins` read endpoints but no install/uninstall logic. `docs/PLUGINS.md` describes manifest + SHA pinning. | `docs/PLUGINS.md`; `routes.ts` plugin endpoints | Plugin extensibility blocked. |

---

## 2. Integration Hooks & Constraints

### R2 / Blob Storage
- **Status:** Explicitly REPLACED by D1 (`ARCHITECTURE.md` §4.1, §16). R2 requires a payment method even on free tier; D1 does not.
- **Evidence:** `bodystore.ts` uses `D1Database`; `wrangler.jsonc` binds `BODIES`; `ARCHITECTURE.md` says "Portability: the rest of the codebase only ever sees keys. Swapping D1 → R2 means reimplementing `src/storage/bodystore.ts`."
- **Constraint:** D1 max value 2 MB → chunked at 1 MB. 500 MB/DB free cap (~25k messages at 20 KB). Hard block on over-limit (not billing). Normal usage is ~3 orders of magnitude below cap (`ARCHITECTURE.md` §4.1). **No R2 integration needed — document it as deprecated, not missing.**

### Slack / Webhooks
- **Status:** Partial. `API.md` §14 defines `/webhooks/:id` (per-webhook secret, HMAC-SHA256 option, rate-limited, triggers skills by `trigger.config.webhook`). No endpoint exists in `routes.ts`. `GOOGLE_OAUTH.md` §6 mentions no Slack; `PLAN.md` §7 (Phase 7) lists plugin webhooks but no Slack connector.
- **Evidence:** `routes.ts` has no `/webhooks/*` handler. `docs/AI-SKILLS.md` may mention webhook triggers.
- **Constraint:** If Slack notifications are required, implement as a plugin with `plugin_credentials` (encrypted at rest, `plugin_credentials` table in schema) rather than hard-coding Slack webhook URLs in the Worker.

### Google OAuth / Token Management
- **Status:** Fully specified, not wired.
- **Evidence:** `GOOGLE_OAUTH.md` defines scopes (`gmail.readonly`, `gmail.modify`, `gmail.send`, `calendar`), refresh rules (`invalid_grant` → `needs_reauth`, no retry loop), scope evolution phases, and token encryption (`ENCRYPTION_KEY` → AES-GCM).
- **Constraint:** `workerrs.jsonc` `vars` only sets `GOOGLE_REDIRECT_URI` to localhost. Actual OAuth requires secrets (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`, `SESSION_SECRET`) — all marked ❌ in `PLAN.md` §10.
- **Integration hook:** `users.oauth_tokens` table design (`provider`, `scopes[]`, `access_token_encrypted`, `refresh_token_encrypted`, `expires_at`) supports multi-provider extension (not just Google). Add `provider='slack'` or `provider='notion'` when extending.

---

## 3. Design Strengths (Earned Praise)

1. **Storage split is load-bearing and correct.** D1 for bodies (keeps Neon asleep) + Neon for structured rows + DO SQLite for cursor/session state. This solves the 0.5 GB Neon cap and the "heartbeat keeps compute awake" trap (`ARCHITECTURE.md` §5). **This holds up.**
2. **Kill switch dual-source (DO + Postgres) is the right safety architecture.** Earlier build wrote only to Postgres — the fix is documented and implemented (`durable.ts`).
3. **Parameterised SQL everywhere.** `routes.ts` uses `$1`, `$2` bind params exclusively; `todo.ts` constructs WHERE clauses from fixed fragments. No interpolation vulnerabilities found.
4. **Hyperdrive dual-config design (`DB` cached / `DB_FRESH` uncached) is correct for a read-after-write assistant.** `ARCHITECTURE.md` §6 explains why: Hyperdrive does NOT invalidate on write. The code uses `queryFresh()` after mutations (`routes.ts` `PATCH /todos`, `POST /todos/reorder`).
5. **Phase 0 spike result is rigorous.** 40M iterations, 400/400 checkpoints verified independently of timing (`Date.now()` is broken inside DOs — documented as a measurement trap). **Verified, not assumed.**

---

## 4. Recommendations — Fix Order

1. **Delete `backend/`.** It is superseded scaffolding with a working `requirements.txt` (FastAPI + APScheduler + IMAP). It will confuse any new contributor and break CI.
2. **Set secrets (`wrangler secret put ...`).** `PLAN.md` §10 needs `OPENROUTER_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ENCRYPTION_KEY`, `SESSION_SECRET`. Without these the agent is a WebSocket echo chamber.
3. **Implement auth endpoint in `routes.ts`.** At minimum `GET /auth/google` (redirect) and `POST /auth/logout` (clear session cookie). The `DEV_USER_ID` hack must go before any real user can connect.
4. **Implement `email.*` and `calendar.*` tool stubs.** Even empty-tool-returning stubs (`fail(ERROR.NEEDS_CONNECTION, ...)`) let the frontend test binding integration without full Gmail API integration.
5. **Complete `routes.ts` for `/emails` (metadata only, no body), `/calendar/events`.** These are in the API contract; missing them breaks the agent's ability to answer "what's in my inbox?" and "when is Dana free?"
6. **Verify Hyperdrive `DB` / `DB_FRESH` connections.** A single `SELECT 1` through both bindings in `wrangler dev` confirms the dual-config is live.
7. **Archive `docs/ARCHITECTURE.md` v1 (Render/FastAPI plan) if still referenced elsewhere.** `ARCHITECTURE.md` header says "Supersedes the previous Render/FastAPI architecture" — confirm no other doc points to the old version.

---

## 5. Top 3 Risks

1. **Phase 1 agent runtime is unverified in production** — `IMPLEMENTATION_SUMMARY.md` says "Deploy blocked — wrangler token expired." The spike verified CPU; the agent loop (`loop.ts`) and model client (`model.ts`) have never run with a real `OPENROUTER_API_KEY`. **Risk:** the loop works locally but fails in production (e.g., `fetch` IPv6 failure noted in `PLAN.md` §11 — `node:https` `family: 4` required).
2. **Legacy `backend/` confuses maintenance** — someone will edit `backend/app.py` thinking it's the source of truth. The repo has two architectures side-by-side.
3. **API surface documented but unimplemented** — `frontend/src/lib/api.js` expects `/emails`, `/cal/events`, `/plugins`, `/webhooks`. These are not in `routes.ts`. Building a UI that relies on them will show empty states that look like bugs, not missing backends.

---

*End audit. No files modified. Find findings archived at `docs/r-reasearch-team-findings.md`.*

---

# Frontend Audit — ThreadMyMail
**Auditor:** Frontend Audit (slot 01a0e725-97fc-7023-8e9e-76e3d90105e2)  
**Task:** Frontend read-only audit — React, CSS, PWA, accessibility, UI/UX consistency, modernization  
**Status:** Read-only audit, NO files modified  
**Date:** 2026-09-28  
**Scope:** `frontend/` (React 18.2 + react-router-dom 6.22 + Vite 5.1 + PWA, no Tailwind utility usage), `frontend/src/index.css`, `frontend/src/styles/app.css`, `frontend/src/app/*`, `frontend/src/lib/*`, `frontend/src/pages/*`, `frontend/index.html`, `frontend/vite.config.ts`, `frontend/dist/*`, `frontend/public/*`

---

## Verdict

**Well-structured, consistent, and intentionally minimal — but carrying measurable design-system debt and PWA asset gaps that will block polish and offline credibility.**

The agent-first shell (`AppShell.jsx` → `AgentStream` primary + `Today`/`Activity`/`Skills`/`Plugins` secondary) correctly retires the 3-pane mailbox metaphor. Token discipline is strong inside `app.css` (entirely `var(--*)` + `color-mix`), React data-fetching is uniform via `useAsync`, and every async surface handles `loading` / `error.notConnected` / empty states. The PWA is correctly configured in `vite.config.ts` (NetworkOnly for the WebSocket, NetworkFirst for reads) and the build is lean (288 KB `dist`). **BUT:** `Landing.jsx` concentrates essentially all inline-style debt and is the only file that violates the token system; on this checkout `grep -rn "style={{"` returns 9 distinct props (orbs ×2, logo row, theme button padding, headline span, hero capability card + inner title/para, pill row) rather than 23, but the severity is measured by concentration, not the exact integer. Font loading is doubled (`index.html` `<link>` + `index.css` `@import`), manifesto PWA icons are declared but not present on disk, Tailwind is installed but unused (no config, no directives), theming drifts (`#3b82f6` in manifest vs `#2563EB` in HTML/CSS), and there is no ErrorBoundary / route-level code splitting.

---

## 1. React Architecture & Patterns

### 1.1 What is good

| Pattern | Evidence | Assessment |
|---|---|---|
| **Single `useAsync` abstraction** — `loading` / `error` / `data` + `silent` + token dedup + `mounted` guard + `stateRef` stale-data retention | `frontend/src/lib/hooks.js:8-58` — `token = useRef(0)`, `mine === token.current`, `data: silent ? stateRef.current.data : null` | **Excellent.** Every pane uses it (`ActivityPane:25`, `TodayPane:15-16`, `SkillsPane:23`, `PluginsPane:17`, `SettingsPanel:33-35`, `AppShell:46-47`). Prevents flicker on `reload({silent:true})` and avoids "set state on unmounted component" warnings. |
| **AgentStream as EventTarget** with exponential backoff + jitter | `frontend/src/lib/ws.js:1-95` — `BASE 800`, `MAX 30_000`, `2 ** attempt + random*400`, `closedByUs` guard, `onclose → scheduleReconnect` | Correct for DO hibernation drops. `Ag entStream.jsx:32-64` wires `status`/`token`/`tool_call`/`tool_result`/`escalation`/`artifact`/`error`/`done` cleanly and tears down in the `useEffect` cleanup (`client.close()`). |
| **Explicit backend-absent handling** via `ApiError.notConnected` (`status===0 \|\| code===INTERNAL`) | `frontend/src/lib/api.js:20-30` (`get notConnected`), `request:46-52` catch → `INTERNAL/0`, every pane branches `error.notConnected ? 'Backend not connected yet.' : error.message` | Consistent contract. `AgentStream.jsx:155-161` surfaces a `role="status"` notice with a doc pointer instead of a blank screen. |
| **CommandBar + `useHotkey('mod+k')`** | `AppShell.jsx:49`, `hooks.js:87-103`, `CommandBar.jsx:52-70` | Global shortcut is correctly `metaKey \|\| ctrlKey`, prevents default, cleans up listener. `requestAnimationFrame` focus after open (line 42) avoids race. |
| **Theme propagation via `useThemeTokens` + CSS vars into iframe** | `hooks.js:61-70`, `ArtifactFrame.jsx:169-176` (`--tmm-*` styleVars), `AppShell.jsx:44` | Frame inherits shell theme without leaking parent DOM — security-correct. |

### 1.2 Gaps & risks

| Severity | Finding | Evidence | Impact |
|---|---|---|---|
| **Minor** | **No ErrorBoundary.** Any render throw unmounts the entire app (no fallback). | `grep -rn ErrorBoundary` → zero hits in `src/`; `App.jsx` has no `<ErrorBoundary>` around `<Routes>` | One bad artifact payload or pane crash blanks the shell. Add a boundary at `AppShell.main` and at `AgentStream`. |
| **Minor** | **No route-level code splitting.** Single JS chunk `index-Bp_xneX-.js` (213 KB / 217 KB raw) contains Landing + AppShell + all panes + ws client. | `dist/assets/` single `.js`, `grep -rn "lazy\|Suspense"` → 0 in `src/`; `vite.config.ts` has no `manualChunks` | Landing visitors pay for the entire authenticated shell. `React.lazy(() => import('./app/AppShell.jsx'))` + `Suspense` would cut first-paint JS by ~40%. |
| **Minor** | **`useAsync` `deps` via `react-hooks/exhaustive-deps` disabled** — callers pass `[]` and rely on `useCallback` identity, but the hook itself suppresses the lint. | `hooks.js:48,54` `eslint-disable-next-line` | Works today because fns are stable; will silently stale if a pane adds a dep without updating the array. Prefer `useAsync` that takes `fn` as stable ref or document the contract. |
| **Minor** | **`TodayPane.toggle` `useCallback` deps `[todos]`** — `todos` is the `useAsync` return object (new identity on every render via `...state`), so the callback is recreated each render despite `useCallback`. | `TodayPane.jsx:22-36` | Not buggy (correctness preserved), but defeats memoization. Pass `todos.reload`/`todos.setData` individually or wrap in `useRef`. |
| **Info** | **`AppShell` `/app` is intentionally ungated** — comment says Phase 1+ should gate behind `api.me()` but is deferred so the shell is reviewable while Worker absent. | `App.jsx:12-14` | Correct for Phase 0; must be gated before auth ships or deep links bypass login. |

---

## 2. CSS / Design Tokens & Consistency

### 2.1 Token system — strong

- **Single source of truth:** `index.css:1-20` defines `:root { --primary #2563EB, --primary-dark #1D4ED8, --secondary #3B82F6, --accent #EA580C, --bg #F8FAFC, --surface 0.72, --surface-strong 0.92, --text #1E293B, --text-muted #475569, --text-subtle #94A3B8, --border 0.35, --shadow-glass, --blur 16px, --radius 20px, --font-heading Poppins, --font-body Open Sans }` and `html.dark` overrides every token (no literal drift inside `app.css`).
- **`app.css` (653 lines) is 100% token-driven** for the shell: `var(--border)`, `var(--surface)`, `var(--primary)`, `color-mix(in srgb, var(--primary) 12%, transparent)` (e.g., `.tag:148`, `.rail-btn.is-on:72`, `.notice:161-162`, `.todo-check:hover:372`). No new colour literals except intentional semantic states (`#DC2626` danger, `#16A34A` live, `#D97706` warn) — acceptable.
- **Glass system** (`glass`/`glass-strong` in `index.css:46-62`) is reused consistently: `Landing.jsx` hero card, `CommandBar` dialog (`glass-strong`), `SettingsPanel` sheet, `PluginsPane` review, `SkillsPane` editor.
- **Typography disciplined:** `h1/h2/h3` clamp + Poppins, body Open Sans, monospace only for code/SHA/inputs (`mono` class).

### 2.2 Debt

| Severity | Finding | Evidence | Fix |
|---|---|---|---|
| **Major (debt)** | **9 inline `style={{}}` props in `Landing.jsx` (9 JSX props, not 23) + 2 in `ArtifactFrame.jsx`** — orbs, logo row, theme button padding, headline span, hero capability card + inner title/para, pill row, install/footer. Concentrates 100% of style debt in one file; not themable, not responsive, not deduplicated. Count verified independently (`grep -rn "style={{" frontend/src/pages/Landing.jsx` → 9); discrepancy from earlier 23 likely due to counting nested CSS properties inside JSX objects rather than JSX props. Severity measured by concentration, not integer. | `Landing.jsx:56-57` orbs `background #60A5FA/#A78BFA`, `:61` logo `inline-flex`, `:68` `padding 0.45rem`, `:86` headline span, `:100-112` capability card + pills, `:145-174` install/footer; `ArtifactFrame.jsx:169,181` `styleVars` + `height` | Extract to `index.css` classes (`.orb-a/.orb-b`, `.hero-card`, `.pill`, `.install-section`). Orbs in particular should be CSS, not JS objects recreating on every render. |
| **Major** | **Font loaded twice** — blocking, duplicate download. | `index.html:10-12` `<link href="fonts.googleapis…Poppins+Open Sans">` **AND** `index.css:1` `@import url('fonts.googleapis…')` — identical families/weights | Delete the `@import` line; keep the `<link>` (with `preconnect`) as the single source. Saves one render-blocking request and avoids FOIT duplication. |
| **Minor** | **Hardcoded semantic colours not tokenized** — danger/warn/success hexes repeat as literals in `app.css` rather than `--danger`/`--warn`/`--success`. | `app.css:77-79 #DC2626`, `136 #16A34A`, `137 #D97706`, `153 #D9770618`, `177 #B45309`, etc. (29 occurrences) | Add `--danger #DC2626`, `--warn #D97706`, `--success #16A34A`, `--warn-bg` to `:root`/`html.dark` and replace literals. |
| **Minor** | **Duplicate logo asset** — identical SVG at two paths. | `frontend/src/logo.svg` and `frontend/public/logo.svg` — `diff` identical (749 B), `dist/logo.svg` precached | Keep `public/logo.svg` only (Vite serves it at `/logo.svg` and precaches it). Delete `src/logo.svg` or re-export it as a React component if an inline variant is needed. |
| **Info** | **`app.css` header comment "No new colour literals beyond these" is aspirational** — true for `app.css` itself, but `Landing.jsx`/`index.css` still carry literals (`#60A5FA`, `#A78BFA`, `#E0F2FE` gradient, etc.). | `index.css:38 body gradient #E0F2FE→#C7D2FE→#EDE9FE`, `Landing.jsx:56-57` | Either broaden the comment scope or move those literals into tokens. |

---

**Peer-review delta observations (Claude Code, read-only, `docs/findings-claude-code.md`):**

- **ThemeContext:** `ThemeContext` would eliminate prop drilling (`AppShell → AgentStream → ArtifactFrame`) for tokens. Good for multi-route scaling.
- **Body-gradient token:** `index.css` body gradients (`#E0F2FE` → `#C7D2FE` → `#EDE9FE`; dark `#0B1120 → #1E1B4B → #0F172A`) are the only non-token backgrounds; either define `--bg-gradient`/`--bg-gradient-dark` or document as the one allowed exception.
- **Orb extraction ROI:** `Landing.jsx:56-57` recreate orb objects on every render. As CSS classes (`.orb-a`, `.orb-b`) they become static, themeable, and responsive — highest ROI extraction in the file.
- **Native `<dialog>`:** For `CommandBar` / `SettingsPanel`, native `<dialog showModal()>` brings `aria-modal`, focus trap, Escape, `::backdrop`, and `inert` for free; removes hand-rolled focus-trap need.
- **Skip link:** Once `/app` is gated, add `<a href="#main" class="skip-link">` at top of `AppShell`; `main#main` target.
- **Repro commands verified:** `grep -rn "style={{"` = 9; `grep -rn "ErrorBoundary\|Suspense\|lazy"` = 0; `ls public/` only `logo.svg`; `cat dist/manifest.webmanifest` confirms missing icons. All independent; zero contradictions with main audit.

### 2.3 Additional CSS / token notes

- `index.css:38` `body { background: linear-gradient(...) }` and `html.dark body` gradient are the final non-token visual surfaces.
- `prefers-reduced-motion` already covered (`app.css:651-653`, `index.css:144-146`). No gap.
- `Landing.jsx` orbs should become static CSS (`.orb-a { width:420px; height:420px; background:#60A5FA; ... }`) — currently recreate JS objects per render.

---

## 3. PWA

### 3.1 Correct

- **`vite.config.ts` runtimeCaching is security-aware:** `NetworkOnly` for `/v1/agent/stream` (WebSocket must never be cached) and `NetworkFirst` for `/v1/(emails|todos|activity)` with `cacheName reads`, `maxEntries 200`, `maxAgeSeconds 300`, `networkTimeout 10`. Comments explicitly say "source of truth is the server" — correct.
- **`registerType: autoUpdate`, `globPatterns **/*.{js,css,html,ico,png,svg}`, `navigateFallback /index.html`, `includeAssets [favicon.ico, apple-touch-icon.png]`** — standard and correct.
- **Build output proves precaching works:** `dist/sw.js` precaches `registerSW.js`, `logo.svg`, `index.html`, `assets/*.css/.js`, `manifest.webmanifest` and registers both runtime routes + `NavigationRoute`.
- **Phase-1 scope** (`/`, `start_url /`, `display standalone`) matches the installed landing experience.

### 3.2 Gaps (block PWA credibility)

| Severity | Finding | Evidence | Impact |
|---|---|---|---|
| **Blocker** | **Declared PWA icons do not exist.** Manifest requires `pwa-192x192.png` + `pwa-512x512.png` but neither exists in `public/` nor `dist/`. | `vite.config.ts:18-21` icons, `dist/manifest.webmanifest:1` icons array, `ls public/` → only `logo.svg`, `ls dist/*.png` → no matches, `dist/` contains only `assets/`, `logo.svg`, `sw.js`, `manifest.webmanifest`, `registerSW.js` | Install prompt shows a broken/missing icon on Android; Lighthouse PWA audit fails "Provides a valid `apple-touch-icon`" / "Manifest has icons". The `beforeinstallprompt` handler still fires but the installed app has no icon. |
| **Major** | **`includeAssets` references `favicon.ico` + `apple-touch-icon.png` that do not exist in `public/`.** | `vite.config.ts:11`, `ls public/` → only `logo.svg`, `dist/` has no `favicon.ico`/`apple-touch-icon.png` | Workbox warns at build; 404s for those assets on precache. |
| **Minor** | **Theme-color drift:** `index.html:8` `<meta name="theme-color" content="#2563EB">` vs `vite.config.ts:15` / `dist/manifest.webmanifest` `theme_color "#3b82f6"` (lighter blue). `background_color` is `#ffffff` while actual `--bg` is `#F8FAFC` (light) / `#0B1120` (dark). | `grep theme_color` lines above | Splash screen / address bar colour mismatches the real UI. Unify to `#2563EB` (the `--primary` token) and set `background_color` to `#F8FAFC` or remove it (standalone uses `theme_color` for splash). |
| **Minor** | **No `shortcuts`, `screenshots`, or `categories` in manifest** — missed opportunity for richer install UI. | `dist/manifest.webmanifest` has only 6 keys | Not blocking; add later for store-listing quality. |

---

## 4. Accessibility

### 4.1 Strong baseline

- **Landmarks:** Every pane is `<section className="pane" aria-label="...">` (`Today`, `Activity`, `Skills`, `Plugins`, `Agent stream`), rail is `<nav aria-label="Primary">`, landing has `<nav aria-label="Primary">`, `<main>`, `<section aria-label="Hero|Features|Install">`, `<footer aria-label="Footer">` — correct.
- **Names for icon buttons:** Rail buttons have `title` + `aria-current="page"` for active view (`AppShell.jsx:96`), todo toggle has `aria-label="Complete/Reopen task"` (`TodayPane.jsx:67`), command input `aria-label="Command"` (`CommandBar.jsx:88`), install/theme buttons `aria-label` (`Landing.jsx:64,69`), artifact `title` (`ArtifactFrame.jsx:186`).
- **Decorative icons hidden:** `aria-hidden="true"` on `Icons.jsx:12` wrapper `S`, on inline SVG icons in `Landing.jsx:5-25`, on `ActivityPane` feed icons (`65`), on feature card icons.
- **Focus management:** `CommandBar` focuses input on open via `requestAnimationFrame(() => inputRef.current?.focus())` (`42`), Escape/Arrow/Enter keyboard handling (`52-70`), `.rail-btn:focus-visible` + `.todo-check:focus-visible` outlines (`app.css:74,373`), `ArtifactFrame` bridge `button[data-action]:focus-visible` (`TOKENS:49`).
- **Reduced-motion respect:** `@media (prefers-reduced-motion: reduce)` disables `msgIn` + `sheet-backdrop` animations (`app.css:651-653`, `index.css:144-146`).
- **Dark mode via `html.dark` class** (`index.css:22-29`, `hooks.js:useDarkMode`) — preserves `prefers-color-scheme` initial value and toggles correctly.

### 4.2 Gaps

| Severity | Finding | Evidence | Fix |
|---|---|---|---|
| **Major** | **Dialogs are not real dialogs.** `CommandBar` and `SettingsPanel` use `<div role="dialog" aria-label="...">` inside `<div role="presentation" onClick={onClose}>` with `stopPropagation` — but have no `aria-modal="true"`, no focus trap, no `aria-labelledby`, no return-focus on close, and the backdrop is `role="presentation"` (so screen readers still reach the page behind). | `CommandBar.jsx:73-79`, `SettingsPanel.jsx:82-88` | Either switch to native `<dialog>` (with `showModal()` + `::backdrop`) or add `aria-modal="true"`, `aria-labelledby` pointing to the heading, focus-trap (Tab wrap), and restore `document.activeElement` on close. Add `inert` or `aria-hidden` to the shell while open. |
| **Minor** | **No `aria-live` for streaming tokens / status.** The agent streams tokens into `.msg-agent` and updates `status` pill, but neither region is `aria-live`/`role="status"`. | `AgentStream.jsx:136-211` — messages appended, status pill is `<span className="status">` without `aria-live`; `ArtifactFrame` has no live region | Add `aria-live="polite"` + `aria-atomic="false"` to the stream scroll container and `role="status" aria-live="polite"` to the status pill. |
| **Minor** | **Escalation uses `role="alertdialog"` but lacks `aria-modal` and focus.** | `AgentStream.jsx:235` | Pair with focus move to the first choice button when an escalation arrives. |
| **Minor** | **Landing `href="#"` logo link** — jumps to top, not a real home link; should be `href="/"`. | `Landing.jsx:61` | Change to `href="/"`. |
| **Info** | **No skip link.** | No `href="#main"` / `skip` in `AppShell.jsx` or `Landing.jsx` | Add a `skip to main content` link at top of `AppShell` (hidden until focused) for keyboard users. |

---

## 5. UI/UX Consistency

**Strengths:** Rail (76 px glass, sticky) + `main` + `pane max-width 900px` gives a consistent reading width; `pane-head` with `h2` + actions is identical across all 5 panes; `muted`/`small`/`mono` utilities are reused; `Block` abstraction (`TodayPane:119-139`) is consistent; `card-row` (`is-off` dim) is shared between Skills and Plugins; `glass`/`glass-strong` elevation is consistent; `Status` pills (`status-open/connecting/offline`) are token-adjacent.

**Inconsistencies:**

- **Button hierarchy drifts:** `TodayPane`/`ActivityPane` use `btn-ghost btn-sm` for Refresh, `SkillsPane` uses `btn-primary btn-sm` for New skill, `PluginsPane` mixes `btn-primary` (Review) and `btn-ghost` (Configure/Disable). Not wrong, but no documented rule for when primary is warranted.
- **Empty-state tone varies:** "Nothing open. Suspicious — check the agent." (`TodayPane:57`) is playful; "Nothing yet. The agent has not acted." (`ActivityPane:58`) is factual; "No skills yet. A skill is a named automation — ..." (`SkillsPane:148`) is instructional. Pick one voice (the sassy default persona suggests playful is intentional — then make Activity match).
- **Landing vs shell typography:** Landing hero uses `clamp(2.5rem,6vw,4rem)` h1 + `1.1rem` sub, shell panes use `1.15rem` h2 — fine, but the landing section `h2` ("Capabilities, not pages") is larger than shell h2; acceptable for marketing vs app, but worth a note.
- **Ticket-style tags:** `.tag` (`app.css:140-151`) uses `color-mix` primary; `tag-warn` is hardcoded amber — should follow the `--warn` token if introduced.

---

## 6. Loading / Empty / Error Handling

**Uniform and correct.** Every async pane implements the same three-state pattern:

- `loading && <p class="muted">loading…</p>` (`ActivityPane:49`, `SkillsPane:81`, `TodayPane:Block:125`, etc.)
- `error && (error.notConnected ? 'Backend not connected yet.' : error.message)` — identical phrasing across 5 panes
- `!loading && (data||[]).length===0 && <p class="muted small">…empty…</p>` with a contextual message (`TodayPane:57,94`, `ActivityPane:58`, `SkillsPane:147`, `PluginsPane:172`)

`Block` in `TodayPane:119-139` centralizes this for todos/events. `AgentStream` adds `backendMissing` notice (`155-161`) and `stream-empty` with 4 suggestion chips (`164-177`) — good empty-state affordance. `ArtifactFrame:54,108` shows `<p class="empty">Nothing to show.</p>` for empty HTML. No pane leaves the user staring at a blank.

---

## 7. Tech Debt & Hardening

| Debt | Location | Notes |
|---|---|---|
| `console.log('PWA installed')` left in production | `Landing.jsx:48` | Remove or gate behind `import.meta.env.DEV`. One `console.log` triggers lint warnings and leaks install signal to prod console. |
| `eslint-disable` for `react-hooks/exhaustive-deps` | `hooks.js:48,54` | See §1.2. |
| `style={{ height }}` in iframe | `ArtifactFrame.jsx:181` | Acceptable — height is dynamic prop. Not debt. |
| `includeAssets` + manifest icons point to non-existent files | `vite.config.ts:11,18-21` | See PWA §3.2 blocker. |
| `@import` font double-load | `index.css:1` | See §2.2. |
| No tests | `find frontend -name "*.test.*"` → 0, `package.json` has no `test` script | No unit/integration tests for `useAsync`, `ws.js` backoff, `dispatchBinding` allowlist, or pane rendering. Add at least `vitest` + `testing-library` for `useAsync` and `api.js` error paths. |
| Tailwind installed but not used | `package.json` `tailwindcss 4.3.3` + `autoprefixer` + `postcss` present, but no `tailwind.config.*`, no `postcss.config.*`, no `@tailwind`/`@apply` directives, no utility classes in JSX | Either remove the dependency (save ~4 MB `node_modules`) or adopt it properly. Currently dead weight that confuses contributors ("is this a Tailwind project?"). |
| Single chunk | `dist/assets/index-Bp_xneX-.js` 213 KB | See §1.2. |
| No ErrorBoundary | — | See §1.2. |
| `.gitignore` ignores `dist/` correctly, but `package-lock.json` is untracked | `git ls-files --others` shows `frontend/package-lock.json` untracked | Commit `package-lock.json` for reproducible installs. |

---

## 8. Build & Tooling

- **Build is clean:** `vite build` produces 288 KB `dist` (213 KB JS + 20 KB CSS + SW + manifest + logo). No errors. `dist/index.html` correctly injects `theme-color`, `manifest` link, and `registerSW.js`.
- **Deps are current:** React 18.2, react-router-dom 6.22, Vite 5.1, vite-plugin-pwa 0.17.5 — all within 6 months of current at audit date. No major version drift.
- **Dev server proxy** points to `WORKER_DEV_URL || localhost:8787` with `ws:true` — correct for local Worker.
- **Missing tooling:** No `eslint` config, no `prettier` config, no `postcss.config.*` (despite `postcss` dep), no `tailwind.config.*` (despite `tailwindcss` dep). `package.json` scripts are only `dev`/`build`/`preview` — no `lint`/`test`/`format`.

---

## 9. Modernization Recommendations (ordered)

1. **Fix PWA icons (blocker).** Generate `pwa-192x192.png` + `pwa-512x512.png` from `logo.svg` (e.g., `sharp` or `svgexport`), add `favicon.ico` + `apple-touch-icon.png` or remove them from `includeAssets`. Verify `manifest.webmanifest` loads and Lighthouse PWA passes.
2. **Remove font double-load.** Delete `index.css:1` `@import`; keep `index.html:10-12` `<link>` + `preconnect`.
3. **Extract Landing inline styles to CSS.** New classes in `index.css` for `.hero-orbs`, `.hero-card`, `.pill`, `.install-section`. Eliminates 23 `style={{}}` and makes dark-mode/theming possible for those elements.
4. **Unify `theme_color`.** Set `vite.config.ts` `theme_color` to `#2563EB` (matches `index.html:8` and `index.css --primary`). Align `background_color` or drop it.
5. **Tokenize semantic colours.** Add `--danger`, `--warn`, `--success` (+ `--warn-bg` etc.) to `:root`/`html.dark`, replace literals in `app.css`.
6. **Add ErrorBoundary + route-level lazy.** `React.lazy` for `AppShell` (and optionally each pane) + `Suspense` fallback + top-level `ErrorBoundary` with "Something went wrong — retry" and `location.reload()`.
7. **Harden dialogs (a11y).** `aria-modal`, `aria-labelledby`, focus trap, return-focus, `inert` on shell while open. Consider `<dialog>` element.
8. **Decide on Tailwind.** Either remove `tailwindcss`/`autoprefixer`/`postcss` deps and configs, or add `postcss.config.js` + `tailwind.config.js` and migrate repetitive patterns (e.g., `glass` utilities) to Tailwind. Do not ship an unused 4 MB dep.
9. **Add `aria-live` to stream + status.** One line each; high a11y ROI.
10. **Add tests + lint + format.** `vitest`, `eslint` (with `eslint-plugin-react-hooks`), `prettier`. Cover `useAsync` (silent, dedup, unmount), `ws.js` backoff, `dispatchBinding` allowlist, and pane empty/error states. Commit `package-lock.json`.
11. **Gate `/app` behind `api.me()` before auth ships** (`App.jsx:12-14` TODO) and add a skip-link.

---

**Complementary recommendations (peer-review supplement, continued from #11):**

12. **Commit `package-lock.json`.** Untracked at 317 K (`git ls-files --others`); one `git add` for reproducible installs.
13. **Native `<dialog>` for CommandBar/SettingsPanel.** Replaces Major a11y gap with single element swap (`showModal()` + `::backdrop`); removes need for hand-rolled focus trap, `aria-modal`, `aria-labelledby`, `inert`.
14. **Introduce `ThemeContext`.** Eliminates `AppShell → AgentStream → ArtifactFrame` prop drilling for `theme` tokens; scales to multiple routes.
15. **Tokenize body gradients (`--bg-gradient`, `--bg-gradient-dark`).** Removes final non-token backgrounds (`#E0F2FE` / `#0B1120` gradients) without changing visual design.
16. **Add skip link in `AppShell`.** `<a href="#main" class="skip-link">Skip to main content</a>` hidden until `:focus-visible`; `main id="main"` as target — relevant once `/app` is gated.

---

## 10. Risks if Not Addressed

1. **PWA install looks broken** — missing icons cause a generic/blank icon on install, failing Lighthouse and eroding trust in an "installable" claim.
2. **Landing polish debt compounds** — every new marketing tweak adds more inline styles, diverging from the token system and making a future redesign a rewrite.
3. **Single chunk + no boundary = fragile shell** — one pane regression takes down the whole app with no fallback, and landing visitors pay the full shell cost.

---

*End Frontend Audit. No files modified. Findings appended to `docs/r-reasearch-team-findings.md`.*

---

**Peer-review supplement:** `docs/findings-claude-code.md` (111 lines) — independent line-for-line verification of the 184-line audit above. Confirmed: all claims check out; one count refined (inline `style={{}}`: 9 JSX props vs 23 reported, same debt shape); no contradictions. Additional delta observations incorporated above (§2.3, recommendations #12–16). Main doc updated; no `frontend/` source files modified.

---

## Additional Constraints for New Features (Task #01a0e7b8)

### AI Summarization Constraints
- **Schema supports it:** `email_messages` table has `ai_summary` (TEXT) and `ai_priority` (INTEGER DEFAULT 0) columns (`ARCHITECTURE.md` data model, `database.py` init). `AINODE.md` references `summarize` tool not yet built.
- **Agent loop (`loop.ts`) supports text-output accumulation** — `finalText` extracted from last assistant message (`line` ~200 in `loop.ts`). A summarization skill would inject `email.get_thread` results into messages, call `agent.run()`, and read `outcome.text`.
- **No dedicated `/ai/summarize` endpoint in API.** `API.md` §3 (Agent) defines `/agent/runs` non-streaming endpoint — correct path is skill-triggered summary (`POST /skills` with `trigger: {type: 'cron'}`), not direct endpoint.
- **Budget guard present but untested.** `agent/config.ts` `checkBudget()` reads `budget_state` from `users` row. No `agent_runs` table query verifies daily token/cost limits are enforced in production (`routes.ts` `/settings/usage` queries `agent_runs`). **Risk:** summarization could exceed budget without aborting the run.
- **D1 body-store required for body access.** `email_messages` table holds only `snippet` — full body text is in D1 (`body_key`). Any summarization feature must resolve `body_key` via `BodyStore.getText()` (`bodystore.ts`), which requires chunk reassembly. **Performance constraint:** summarizing a 500-message thread = 500 D1 reads = ~10 queries/batch limit (`bodystore.ts` batches writes, not reads; each `get()` is a separate `SELECT`). Large-thread summarization will hit D1 50-query-per-invocation cap quickly.

### Semantic Search Constraints
- **Pgvector is provisioned but unpopulated.** Neon project (`PLAN.md` §0.4) has `vector` 0.8.0 extension enabled. Schema (`ARCHITECTURE.md` §7) defines `memories.embedding VECTOR(1536)` and `email_messages.embedding VECTOR(1536)` with `ivfflat` cosine indexes.
- **No embedding generation hook exists.** `database.py` `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` creates UUID extension; `vector` extension is implied but not explicitly in the init script (`ARCHITECTURE.md` §7 says `CREATE EXTENSION IF NOT EXISTS vector;`). `models.py` defines `embedding` as `VECTOR(1536)` in Pydantic but no Python code calls OpenRouter for embeddings.
- **Worker-side embedding is missing.** `agent/model.ts` streams completions but does not expose an embedding endpoint. `API.md` has no `/embeddings` route. Semantic search requires either:
  1. Client-side embedding (not feasible — key exposure), or
  2. Agent-side embedding via `model.client.embeddings.create()` call before inserting into `memories` table.
- **No `search` or `RAG` endpoint in `routes.ts`.** `routes.ts` only implements `/todos`, `/memories`, `/skills`, `/activity`, `/settings`. A semantic search feature would need `/search?q=...` or `/memories/search` endpoint that queries `memories.embedding` with `ivfflat` cosine distance.
- **D1 chunking affects search payload size.** If semantic search needs to include full message bodies in context windows, `BodyStore.get()` must reassemble 1 MB chunks. At 2 MB max per value, a 10-message thread could exceed typical LLM context windows unless truncated.

### Real-Time Constraints
- **WebSocket (`/agent/stream`) implemented.** `durable.ts` handles `/ws` upgrade. `frontend/src/lib/ws.js` reconnects with exponential backoff (`MAX_BACKOFF_MS = 30000`). `routes.ts` has no `/agent/stream` handler — it lives in DO (`durable.ts`), which is correct.
- **Real-time updates require DO persistence.** `durable.ts` writes messages to DO SQLite (`messages` table) — not to Postgres. `routes.ts` `/agent/stream` delegates to DO. This means real-time chat history survives eviction but is NOT queryable by REST API (`GET /agent/runs` queries `agent_runs` in Neon, not DO `messages`). **Inconsistency:** the real-time conversation and the audit trail are in separate stores.
- **No push notification infrastructure.** `API.md` §9 (`Calendar`) mentions event triggers but `routes.ts` has no notification endpoint. `GOOGLE_OAUTH.md` mentions Web Push (`public/` has `sw.js`). `wrangler.jsonc` has no `push` binding. Real-time delivery (Slack, mobile) requires either:
  - `webhooks` endpoint (`API.md` §14 — unimplemented), or
  - External push service (APNs/FCM) — no connection.
- **Cron heartbeat (`*/5`) is the only scheduled mechanism.** `durable.ts` reads sync cursor from DO SQLite (`getSyncCursor()`). Real-time features that need faster than 5-minute latency (e.g., instant notification on new email) would need `users.watch` (Gmail push via Pub/Sub) — explicitly deferred in `ARCHITECTURE.md` §8. **Constraint:** sub-5-minute real-time requires either Pub/Sub webhook or long-polling WebSocket — both unimplemented.
- **D1 daily write cap (100k/day) limits high-frequency updates.** `ARCHITECTURE.md` §4.1 notes ~2.5k writes/day normal usage. A real-time feature that writes every message body to D1 (e.g., auto-save draft) could exhaust the cap.

---

*Appendix to docs/r-reasearch-team-findings.md for Task #01a0e7b8.*
