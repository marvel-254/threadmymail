# Handoff — 2026-10-06

> **Direction change (2026-10-06):** the product pivoted. The APK is now a
> **self-contained mobile harness** (BYOK AI + SMTP/IMAP app-password email,
> no OAuth, no backend), built with **Expo**. The website becomes a landing +
> download page. The Cloudflare Worker agent is **no longer the product**.
> Read `mobile/MOBILE-STRATEGY.md` and `mobile/MVP-UI.md` first. The 2026-10-02
> content below is kept for history.

Where things stand, written for whoever picks this up next. For the reasoning
behind decisions, see `agent.md` (current state and invariants) and
`IMPLEMENTATION_SUMMARY.md` (chronological session log).

---

## Mobile harness — the new direction (2026-10-06)

The Android app is now the product: a **harness** that holds the user's email
credentials (SMTP/IMAP + app password) and their AI key (BYOK), and runs the
agent loop **on-device**. No OAuth, no server, no Cloudflare dependency.

**Docs created this session:**
- `mobile/MOBILE-STRATEGY.md` — the authoritative plan (architecture, verified
  IMAP/SMTP library, build checklist, desktop roadmap).
- `mobile/MVP-UI.md` — MVP UI design (screens, navigation, onboarding,
  components).
- `mobile/APK.md` — **superseded** (banner added); kept for history only.

**Key research finding:** raw IMAP/SMTP needs a native module in RN (pure-JS
clients need Node's `net`/`tls`, which don't exist in Hermes). Verified
solution: **`react-native-mail-engine`** (Nitro module, New Architecture,
Android via JavaMail, iOS via MailCore2, app-password auth, IMAP IDLE push).
Requires a **dev build** (not Expo Go). Fallback: custom JavaMail module.

**Build pattern:** reuse `bro`'s — build the APK in **GitHub Actions**
(`expo prebuild` + Gradle + Java 17), no EAS account needed. Sign with a
keystore stored as a GitHub secret.

**Scope agreed (MVP):** skills (triage/drafts/follow-ups, schedules, budgets,
quiet hours, shadow mode, kill switch), on-device memory (`expo-sqlite`),
multi-provider BYOK (OpenRouter/OpenAI/Anthropic/Gemini/DeepSeek/custom).

**Next step (the risk gate):** scaffold the Expo app and run the **email
bridge spike** — integrate `react-native-mail-engine`, connect a Gmail
app-password account, verify IMAP read + SMTP send on a dev build.

**Needed from the user to start:** repo home (suggested: new repo
`marvel-254/threadmymail-app`), a test Gmail account + app password, and a
decision on who holds the signing keystore.

---

## Live right now

| | |
|---|---|
| App | **https://threadmymail.omixsystems.store/app** |
| Pages fallback | `https://threadmymail.pages.dev/app` |
| API origin | `https://threadmymail-worker.twistedoliver211fs.workers.dev` (proxied same-origin at `/v1/*`) |
| Worker version | `701912be` (deployed this session) |
| Provider keys stored | **0** — clean slot, nothing to rotate or re-enter |
| HEAD | `d87d293` — DocNav + mobile fixes, handoff updated |

**The frontend and Worker are deployed and verified.** All verification checks
passed on the custom domain, including the fixed `/v1/skills 401` proxy check.

---

## What was done this session

### Google OAuth — now working ✅

The owner completed the first Google consent and the OAuth flow is confirmed
end-to-end. Sign-in works. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are
set as Worker secrets.

**No code was changed for OAuth** — the implementation from the previous session
was already correct. The only missing piece was the owner walking through the
Google consent screen.

### System.jsx — provider/model endpoints fixed ✅

`api.providers()` returns `{ providers, credentials, writable }`, not a flat
array. The component was treating the whole response as the provider list
(always empty) and hardcoding `config` to `null`.

**Fixed:**
- `providers` is now read from `prov.providers`
- `credentials` (the `has_key` status list) is read from `prov.credentials`
- `config` now comes from `api.settings()` which returns `{ ai_config, … }`
- `primary` is read from `config?.ai_config?.primary` (correct path)

File: `frontend/src/pages/System.jsx`

### Deploy script — false positive fixed ✅

The `/v1/skills` proxy check was failing with "FAILED" because it required HTTP
200, but the endpoint correctly returns 401 (unauthenticated). Updated to accept
200 **or** 401 as valid — both prove the proxy is routing to the Worker.

File: `scripts/deploy.sh`

### `oauth_tokens` UNIQUE constraint — applied to Neon ✅

Added `UNIQUE(user_id, provider)` to `oauth_tokens` so that re-auth upserts
cannot create duplicate rows and the callback can safely use `ON CONFLICT`.

Migration: `apps/worker/drizzle/0002_oauth_tokens_unique.sql`
Applied: 1/1 statements, `Schema applied.`

### Logo and favicon — replaced with desired-logo.jpeg ✅

All browser and PWA icon slots now show the desired logo. Assets generated from
`desired-logo.jpeg` (1280×1280 JPEG at the project root) using ImageMagick:

| File | Size | Purpose |
|---|---|---|
| `frontend/public/favicon.ico` | 48×48 | Browser tab icon |
| `frontend/public/logo.svg` | SVG wrapper | `<link rel="icon" type="image/svg+xml">` |
| `frontend/public/pwa-192x192.png` | 192×192 | PWA manifest icon |
| `frontend/public/pwa-192x192-maskable.png` | 192×192 | PWA maskable icon |
| `frontend/public/pwa-512x512.png` | 512×512 | PWA splash / install |
| `frontend/public/pwa-512x512-maskable.png` | 512×512 | PWA maskable splash |
| `frontend/public/apple-touch-icon.png` | 180×180 | iOS home screen |
| `frontend/src/logo.svg` | SVG wrapper | React component usage |

### DocNav — back-to-home bar on all doc pages ✅

Added `DocNav` component: a sticky Win95 toolbar at the top of `Docs`, `Legal`
(terms + privacy), and `System`. Provides:
- **Back** button (`useNavigate(-1)`) — returns to wherever the user came from
- **Home** button (`Link to="/"`) — always goes to the landing page
- Secondary cross-links between doc pages (hidden on mobile)
- Mobile: title and secondary links hidden at ≤767px, only Back + Home shown

Also fixed mobile layout across doc pages: reduced padding, `.sys-grid` 2-col,
`.sys-providers` single-col, `doc-note`/`doc-clause` unrestricted width.

Files: `frontend/src/components/DocNav.jsx`, `frontend/src/styles/retro-landing.css`,
`frontend/src/pages/{Docs,Legal,System}.jsx`

### In-app logo (MilloMark) — replaced with desired-logo image ✅

`MilloMark` was a hand-drawn SVG (envelope + pulse motif). It is now an
`<img src="/logo.svg">` that renders the actual desired logo at whatever `size`
prop is passed. Every in-app placement now shows the correct logo:

| Location | Size | Context |
|---|---|---|
| `pages/SignIn.jsx` | 64px | Sign-in avatar card |
| `mail/ShellStates.jsx` | 44px | Full-shell loading spinner |
| `pages/Landing.jsx` navbar | 22px | Top nav brand mark |
| `pages/Landing.jsx` footer | 18px | Footer brand mark |

File: `frontend/src/components/MilloMark.jsx`

---

## ⚠️ Outstanding items

### 🟡 Cloudflare OAuth expires roughly daily

If `wrangler deploy` fails with auth errors:

```bash
cd apps/worker && ./node_modules/.bin/wrangler login
```

Then re-run `bash scripts/deploy.sh --allow-dirty`.

### 🟡 A real provider key is still needed

Paste one in Settings to enable actual agent runs. User action, not
engineering. Until a key is set, `run` will fail with `NO_API_KEY` /
`NO_MODEL` — that is expected, not a bug.

### 🟡 CI is a Python pipeline

Needs replacing with TypeScript. Not urgent but will cause confusion.

---

## What was done today -- 2026-10-10

### Mobile harness -- persistence and wiring

The scaffold from 2026-10-06 is now end-to-end functional.

**New files:**
- `mobile-app/src/lib/providerStore.ts` -- BYOK AI key persistence in SecureStore.
  `addProvider / removeProvider / setPrimary / getPrimaryProvider / maskKey`.
  `testProvider` calls GET /models (12s timeout) to prove key valid, URL right, host reachable.
- `mobile-app/src/lib/prefs.ts` -- onboarding flag in SecureStore (no new native deps).
  The old pure-React-state gate in AppShell is gone; onboarding now survives restarts.
- `mobile-app/src/lib/emailTest.ts` -- live IMAP connection test (opens INBOX, reads one header).
  Maps common JavaMail errors to human-readable instructions.
- `mobile-app/plugins/withAndroidReleaseSigning.js` -- injects keystore signingConfig at
  prebuild time. No hand-editing of android/. No-ops without secrets, warns clearly.
  Inputs: THMMY_KEYSTORE_FILE / PASSWORD, THMMY_KEY_ALIAS / PASSWORD.

**SMTP fix:**
- `mobile-app/src/lib/mailSync.ts`: `start()` now passes `smtp:` to `bridge.connect()`.
  Harness could not send before; this was a silent regression.

**AppShell rewrites:**
- Reads `isOnboarded()` from storage before rendering; ActivityIndicator during load.
  Configured users never see the wizard flash.
- Auto-starts `getMailSync()` if an account is already saved.

**Onboarding rewrites:**
- Step 1 (email): provider picker + Custom IMAP/SMTP fields + live test + Save to accountStore.
  Gmail app-password guidance shown in helper text.
- Step 2 (AI): provider picker + key + base URL + model + live test via testProvider.
- Step 3: skill toggles (stubs for now).

**SettingsScreen rewrites:**
- Email: connect/disconnect wired to accountStore + live testImap on save.
- AI providers: list from providerStore, add sheet (live test), per-card test button,
  remove with confirm dialog, set-primary button per non-primary provider.
- Guardrails: Kill switch + Shadow mode toggles (in-memory for now).
- Memory: placeholder showing 0 entries.

**GitHub Actions (`.github/workflows/android-build.yml`):**
- Keystore setup from THMMY_KEYSTORE_BASE64 secret.
- APK signature verification (checks META-INF/CERT.RSA/DSA).
- Optional GitHub Release via workflow_dispatch + release_tag input.

**README rewritten** to match the mobile-harness product direction.

**Typecheck: clean** (npx tsc --noEmit in mobile-app/)


---

 What to build next

1. **Mobile harness (the product now)** — see `mobile/MOBILE-STRATEGY.md`.
   Start with the **email bridge spike** (risk gate): scaffold the Expo app,
   integrate `react-native-mail-engine`, verify IMAP read + SMTP send.
2. **Website → download page** — replace the 4 "Get Started" CTAs in
   `frontend/src/pages/Landing.jsx` with a "Download for Android" button;
   disable `/app` and `/signin`; host the APK on a GitHub release.
3. **Desktop (later)** — Electron + `nodemailer`/`imapflow` reusing the Expo
   web export (easier than Android; see MOBILE-STRATEGY §5).

The old Cloudflare Worker roadmap (Phase 4 workflows etc.) is **parked** — the
Worker is no longer the product.

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
