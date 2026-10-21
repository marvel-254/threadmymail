# Handoff — 2026-10-21

> **The product is the Android APK.** ThreadMyMail (Millo) is a self-contained
> **on-device AI email agent harness** (BYOK AI + SMTP/IMAP app-password email,
> no OAuth, no backend). Built with **Expo 57** (React Native, New Architecture).
> The website is a landing + download page. Read `mobile-app/AGENTS.md` and
> `agent.md` first.

---

## Live right now

| | |
|---|---|
| **v3.0.0 released** | https://github.com/marvel-254/threadmymail/releases/tag/v3.0.0 |
| **APK** | `app-release.apk` (41.9 MB, arm64-v8a, signed with release keystore) |
| Landing page | https://threadmymail.omixsystems.store (download buttons → GitHub release) |
| Pages fallback | https://threadmymail.pages.dev/app |
| Worker (legacy, still live) | https://threadmymail-worker.twistedoliver211fs.workers.dev |
| HEAD | `952e5c8` — cleanup commit (superseded dirs + dead frontend code removed) |

---

## What was done this session (2026-10-21)

### CI — all green except Release, now fixed ✅

| Workflow | Status | Notes |
|---|---|---|
| `ThreadMyMail CI` (ci-cd.yml) | ✅ passing | typecheck-worker + build-frontend |
| `ThreadMyMail Android Build` (android-build.yml) | ✅ passing | latest push build all steps green |
| `ThreadMyMail Release` (release.yml) | ❌→ fixed | had keystore-before-prebuild bug; fixed in `8d5661e` |

**Two CI bugs fixed:**
1. `android-build.yml` + `release.yml`: "Prepare keystore" ran **before** `expo prebuild` created `android/`, so the write failed. Moved after prebuild.
2. Secrets: `THMMY_KEYSTORE_FILE` was missing, key password wrong. Set all five correctly from the local keystore.

**Release workflow note:** the "Create GitHub Release" step in `android-build.yml` cannot push tags (GITHUB_TOKEN lacks push permission) — releases are created manually via `gh release create/upload/edit`. The `release.yml` (tag-triggered) is the intended path but also needs the keystore fix (done) and a tag push.

### v3.0.0 release published ✅

- APK built, signed (v2/v3 APK Sig Block confirmed), uploaded to GitHub Release.
- Release created manually (workflow's release step can't push tags).
- Robo test passed on this build earlier (Pixel2.arm-30-en-portrait, 200+ actions, no crashes).

### Repo cleanup ✅

Removed superseded/dead files (commit `952e5c8`):
- `backend/` (Python FastAPI — superseded by on-device harness)
- `hosting/RENDER.md`, `deploy/RENDER_AUTO_DEPLOY.md` (Render no longer target)
- root `desired-logo.jpeg`, `logo-desired.png` (generated icons live in `frontend/public/`)
- `frontend/src/mail/`, `frontend/src/app/`, `frontend/src/lib/{useSession,hooks,ws}.js` — unrouted dead code
- `frontend/src/styles/{landing,auth,mail}.css` — not imported (main.jsx comment updated)
- `frontend/src/pwa/InstallBanner.jsx` — not imported anywhere

Also removed ~217 MB of untracked heavy artifacts (APK builds, screenshots, previews) from the working folder.

**Kept:** `apps/worker` (live Worker — still deployed and serving the frontend's System page), `functions/` (live Pages proxy to Worker), `mobile/` (design docs), `docs/` (architecture docs).

---

## Mobile harness — the product

The Android app is a **harness** that holds the user's email credentials
(SMTP/IMAP + app password) and their AI key (BYOK), and runs the agent loop
**on-device**. No OAuth, no server, no Cloudflare dependency.

**Docs:** `mobile/MOBILE-STRATEGY.md` (authoritative plan), `mobile/MVP-UI.md`
(MVP UI design), `mobile/APK.md` (superseded, history only).

**Key research finding:** raw IMAP/SMTP needs a native module in RN (pure-JS
clients need Node's `net`/`tls`, which don't exist in Hermes). Verified
solution: **`react-native-mail-engine`** (Nitro module, New Architecture,
Android via JavaMail, iOS via MailCore2, app-password auth, IMAP IDLE push).
Requires a **dev build** (not Expo Go).

**Build pattern:** build the APK in **GitHub Actions** (`expo prebuild` +
Gradle + Java 17), no EAS account needed. Sign with a keystore stored as
GitHub secrets.

---

## v3 Android-native chat redesign (2026-10-20)

Implemented `new-chat-panel-ui-design-principal.md` in `mobile-app/`:

- **AgentScreen rewritten** — native top app bar (menu + title + overflow),
  stop-generation bar, long-press sheet (copy / use-as-context), empty state
  with 3 starter actions, inset-aware composer, overflow Modal, loading state.
- **conversationStore.ts** — expo-sqlite conversations + messages tables, CRUD,
  StreamItem↔Message converters.
- **Drawer.tsx + EdgeSwipe.tsx** — overlay drawer (recent convos, New Chat,
  Search, Inbox/Actions/Settings destinations), left-edge swipe to open,
  back/outside dismiss.
- **Wallpaper system** (`lib/wallpaper.ts`, `WallpaperPicker.tsx`) — presets +
  custom photo picker, global default + per-conversation override, persisted.
- **Message references to email threads** — emailRefs on messages, chips in
  AgentScreen, MailScreen opens the thread.
- **expo-clipboard** installed for long-press copy.

**Verified:** `npx tsc --noEmit` clean; Firebase Robo test passed
(Pixel2.arm-30-en-portrait, 200+ actions, no crashes); release APK built,
signed, and published as v3.0.0.

---

## What to build next

1. **Real-device test** with a test Gmail app-password account (the risk gate
   from the original plan — bridge is wired but not exercised on a physical
   phone with real credentials).
2. **Agent loop** — the actual triage/draft/follow-up skills on-device
   (`docs/AI-SKILLS.md`), schedules, budgets, quiet hours, shadow mode.
3. **On-device memory** — `expo-sqlite` for conversation history (store exists;
   wire the agent's memory reads/writes).
4. **Website polish** — landing page is functional; consider a changelog page
   (in progress in user's working tree).

---

## Deploying

The Worker + Pages frontend are legacy but still live. `scripts/deploy.sh`
deploys them:

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

---

## Repo layout (after 2026-10-21 cleanup)

```
threadmymail/
├── mobile-app/              # The product — Expo 57 React Native app
│   ├── src/screens/         # Onboarding, Today, Mail, Agent, Activity, Settings
│   ├── src/components/      # ui, inbox, mail, agent, settings, icons, BottomTabBar,
│   │                        # TopBar, Drawer, EdgeSwipe, WallpaperPicker
│   ├── src/lib/             # mailBridge, mailSync, mailStore, accountStore,
│   │                        # providerStore, prefs, emailTest, providers,
│   │                        # conversationStore, wallpaper, guardrails, aiClient
│   ├── src/theme/           # Design tokens
│   ├── plugins/             # 3 Expo config plugins (signing, mail-engine link, pickFirsts)
│   └── scripts/             # patch-mail-engine.js
├── frontend/                # Landing/download page (Vite + React + Tailwind + PWA)
├── apps/worker/             # Legacy Cloudflare Worker (still deployed, not the product)
├── functions/               # Legacy Pages proxy → Worker (still live)
├── mobile/                  # Mobile design docs (MOBILE-STRATEGY, MVP-UI, etc.)
├── docs/                    # Architecture, planning, reference docs
├── .github/workflows/       # android-build.yml, release.yml, ci-cd.yml
└── scripts/                 # deploy.sh (legacy Worker+Pages deploy)
```

**Removed 2026-10-21:** `backend/` (superseded Python), `hosting/` + `deploy/`
(Render-era), root logo sources, dead frontend code (`mail/`, `app/`,
unused styles, InstallBanner).
