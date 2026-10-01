# Handoff — 2026-10-02

Where things stand after today's session, written for whoever picks this up
next. For the reasoning behind decisions, see `agent.md` (current state and
invariants) and `IMPLEMENTATION_SUMMARY.md` (chronological session log).

---

## Live right now

| | |
|---|---|
| App | **https://threadmymail.omixsystems.store/app** |
| Pages fallback | `https://threadmymail.pages.dev/app` |
| API origin | `https://threadmymail-worker.twistedoliver211fs.workers.dev` (proxied same-origin at `/v1/*`) |
| Worker version | `b622ff20` (current session deploy) |
| Provider keys stored | **0** — clean slot, nothing to rotate or re-enter |
| HEAD | `c6441fc` — retro design system, committed and pushed |

**The frontend and Worker are deployed.** The retro design system is live
at the custom domain. The deploy script ran to completion; the one "FAILED"
line (`/v1/skills` returned 401) is a false positive — 401 proves the proxy is
routing to the Worker correctly. The check assumes a 200 but that endpoint
requires a session cookie, so 401 is the right answer.

---

## What was done this session

### The redesign: 90s Nostalgia / Win95

The Silk dark neomorphic design system has been replaced with a full
1997-era Win95 aesthetic. No logic, routing, or API code was changed.

**New files:**

| File | What it is |
|---|---|
| `frontend/src/styles/retro.css` | Win95 palette tokens, `@keyframes` (rainbow, pulse-glow, blink), bevel primitives, `.win-window` / `.win-titlebar`, `.r-btn*`, `.bg-tile`, `.bg-construction`, `.hr-groove`, `.hit-counter`, `.r-badge-new`, `.text-rainbow`, `.r-table` |
| `frontend/src/styles/retro-landing.css` | All `.lp-*`, `.doc-*`, `.sys-*` overrides |
| `frontend/src/styles/retro-auth.css` | All `.si-*`, `.install` overrides |
| `frontend/src/styles/retro-mail.css` | Full MailShell chrome — topbar, rail, feed, workstation, sheets, stream, copilot, mobile tabs |

**Modified files:**

| File | What changed |
|---|---|
| `frontend/src/styles/silk.css` | Stripped dark glow/blur/shadow token values; all CSS custom properties now point at Win95 silver/black/navy; Material Symbols `@import` preserved |
| `frontend/src/main.jsx` | Import order: silk → retro → retro-landing → retro-auth → retro-mail; old landing/auth/mail CSS removed |
| `frontend/src/pages/Landing.jsx` | Marquee bar, rainbow `<em>`, NEW! badge, colour squares, hit-counter stats bar, groove HR dividers, construction-stripe closing CTA, Win95 product surface preview |
| `frontend/src/pages/SignIn.jsx` | Win95 dialog card (`::before` title bar), beveled Google button, alternating trust rows, bottom marquee strip |
| `frontend/src/pages/System.jsx` | Hit-counter black/green stat boxes, Win95 section cards |
| `frontend/src/pages/Docs.jsx` | Win95 window sections with navy titlebar headings, groove HR |
| `frontend/src/pages/Legal.jsx` | Same as Docs |
| `frontend/src/components/MilloMark.jsx` | Gradient updated to Win95 navy→blue |
| `frontend/package.json` / `package-lock.json` | Added `react-fast-marquee@1.6.5` (exact pin) |

**Dependency:** `react-fast-marquee@1.6.5` — used for the announcement
marquee bar on the landing page and the strip on the sign-in page.

**Visual checklist satisfied:**
- Marquee scrolling text ✓
- Rainbow animated hero heading ✓
- All buttons: 3D outset bevel with correct 4-value `border-color` ✓
- Win95 titlebar gradient cards on every section ✓
- Tiled `#c0c0c0` background on body ✓
- Links: blue, visited purple, hover red, always underlined ✓
- Alternating row backgrounds on tables and lists ✓
- Groove HR dividers between sections ✓
- Hit-counter stats (black bg, green mono text) ✓
- NEW! badge with pulse-glow animation ✓
- Construction stripe background on closing CTA ✓
- Dotted focus outlines everywhere ✓
- Active buttons: inset bevel + `translate(1px, 1px)` ✓
- Icons: 2px stroke via Material Symbols ✓
- Zero `border-radius` anywhere ✓

### Also committed this session

The following pre-existing working-tree changes from the previous session
had been deployed but not committed. They are included in `c6441fc`:

- `apps/worker/src/http/auth.ts` — Google OAuth fixes
- `apps/worker/wrangler.jsonc` — config updates
- `docs/GOOGLE_OAUTH.md` — OAuth documentation
- `frontend/vite.config.ts` — vite config tweaks
- `scripts/deploy.sh` — deploy script improvements

---

## ⚠️ Known risks, unchanged from previous session

### 🟡 Complete the first Google consent

OAuth is still the first thing to complete. See the previous handoff for
the full flow — nothing has changed on that front. The OAuth start endpoint
is live and returning a Google redirect; what is missing is the owner's
consent and a successful callback.

### 🟡 Cloudflare OAuth expires roughly daily

This bit during this session — both tokens were stale and `wrangler login`
had to be re-run from `apps/worker`. The recovery is always the same:

```bash
cd apps/worker && ./node_modules/.bin/wrangler login
```

Then re-run `bash scripts/deploy.sh --allow-dirty`.

### 🟡 Deploy script `/v1/skills` check is a false positive

The final verification step checks `$APP_ORIGIN/v1/skills` for HTTP 200.
That endpoint requires a session cookie and returns 401 when unauthenticated,
which is correct behaviour. The script marks this as FAILED. Everything else
in the verification block passed. This check should be updated to accept 401
as a valid "proxy is working" response.

### 🟡 `oauth_tokens` UNIQUE constraint still missing

See previous handoff. One SQL statement on Neon, not run unilaterally.

### 🟡 `System.jsx` reads the wrong endpoints

`api.providers()` hits `/settings/providers` which returns the provider
catalogue with no `has_key` field, so the configured list is always empty.
`config` is hard-coded to `Promise.resolve(null)`. Described in detail in
the previous handoff — not changed this session.

### 🟡 A real provider key is still needed

Paste one in Settings. User action, not engineering.

---

## What to build next

1. **Google OAuth** — still the blocker for any real mail processing.
2. **A real provider key** (user action) — last thing blocking a live model turn.
3. **Fix `System.jsx` provider/model endpoints** — straightforward wiring fix.
4. **Fix the deploy script's `/v1/skills` check** — accept 401 as valid proxy response.
5. **Phase 4** — workflows, real undo, activity feed.

---

## Deploying

```bash
bash scripts/deploy.sh --allow-dirty   # if untracked files exist
bash scripts/deploy.sh                 # clean tree only
bash scripts/deploy.sh --skip-frontend # API only
```

If auth fails: `cd apps/worker && ./node_modules/.bin/wrangler login`

---

## Invariants that must survive

The eight in `agent.md` are load-bearing. See previous handoffs for detail.
The most dangerous to break accidentally:

- **#1** — an idle heartbeat tick issues zero Postgres queries.
- **#3** — read-after-write must go through `DB_FRESH` / `queryFresh`.
- **#8** — there is no public tool-invocation endpoint.
