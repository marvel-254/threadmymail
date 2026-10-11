# ThreadMyMail — Mobile & Multiplatform Strategy

> **Status:** Authoritative. **Last updated:** 2026-10-06
> **Supersedes:** `mobile/APK.md` (the old Expo/EAS guide). The product
> direction changed materially on 2026-10-06: the APK is now a **self-contained
> harness** (BYOK AI + SMTP/IMAP email, no OAuth), and the website becomes a
> **landing + download page** (no sign-in).

---

## 0. Decision log (2026-10-06)

| # | Decision | Rationale |
|---|---|---|
| 1 | Build the app with **Expo** (React Native) | Native feel, one TS codebase, proven on `bro` |
| 2 | **No OAuth.** The APK is a **harness** for both email and AI | Credentials belong to the user, never a server |
| 3 | Email connects via **SMTP/IMAP + app password** | Works for any provider (Gmail/Outlook/Yahoo/iCloud/self-hosted) |
| 4 | AI is **BYOK** — any OpenAI-compatible provider | User brings their own key; no account, no subscription |
| 5 | Website **stays** but becomes a **landing + download page** | It's the web presence; "Get Started"/sign-in is removed |
| 6 | **(Later)** Desktop: **Windows .exe** + **Linux AppImage** | Multiplatform; desktop is *easier* than Android (see §5) |

The old Cloudflare Worker (Google OAuth + Gmail/Calendar agent) is **no longer
the product**. It may be retired or kept dormant. The web app no longer hosts
the agent.

---

## 1. Product concept: the harness

The APK is a **harness** that holds two things the user brings, and runs the
agent loop on-device:

```
        ┌─────────────────────────── APK (the harness) ───────────────────────────┐
        │                                                                          │
        │   ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────────┐  │
        │   │ Email bridge │   │   AI client  │   │  Agent loop (the product)    │  │
        │   │ IMAP + SMTP  │   │  BYOK fetch  │   │  triage → draft → act → log  │  │
        │   │ (native)     │   │  (any key)   │   │  runs on-device in TS        │  │
        │   └──────┬───────┘   └──────┬───────┘   └──────────────┬──────────────┘  │
        │          │                  │                          │                 │
        │   SecureStore (encrypted)   │                          │                 │
        │   └── app password + AI key ┘                          │                 │
        └────────────────────────────────────────────────────────┘                 │
                                             │  (no backend, no OAuth, no server)    │
```

- **Credentials never leave the phone.** Email app-password + AI key live in
  `expo-secure-store` (Android Keystore-backed).
- The **agent loop runs in the app's JS/TS layer**: pull mail via the email
  bridge → send to the user's AI provider → act (draft, send via SMTP, file,
  follow up) → write to an activity log.
- **No backend dependency.** The app works standalone.

---

## 2. The hard part: IMAP/SMTP in React Native (researched 2026-10-06)

Raw IMAP/SMTP needs a **native module**. Pure-JS clients (`imapflow`,
`node-imap`, `emailjs-imap-client`) depend on Node's `net`/`tls` sockets, which
do **not** exist in the Hermes/RN runtime — they throw on import. Expo Go also
cannot run custom native modules, so the harness needs a **development build**
(`expo prebuild` + dev client, or a CI build).

### Verified solution: `react-native-mail-engine`

- **Repo:** https://github.com/aashir-athar/react-native-mail-engine (MIT, maintained)
- **What it is:** a Nitro module for the New Architecture (RN 0.79+, which
  Expo SDK 53 uses by default). **Android via JavaMail**
  (`com.sun.mail:android-mail`), **iOS via MailCore2**.
- **Covers everything the harness needs:**
  - IMAP fetch/search/flags/move/copy/delete + parsed MIME + attachments
  - SMTP send with attachments
  - **`idle()` — real-time push without polling** (works while app is running)
  - **Password / app-password auth** — exactly our model:
    `auth: { type: 'password', user, password }`
  - Typed errors (`ERR_CONNECT`, `ERR_AUTH`, `ERR_TLS`, `ERR_TIMEOUT`, …)
- **Expo integration:** config plugin exists; add `"react-native-mail-engine"`
  to `app.json` plugins, then `expo prebuild` + dev build. Android autolinks;
  R8 keep-rules ship automatically.
- **Requirements:** RN 0.79+ New Architecture, `react-native-nitro-modules`,
  Android minSdk 24+.
- **Honest limitations (from the library's own docs):**
  - Background IDLE does not survive app suspension. On Android, true
    background IDLE needs a **foreground service** (a v1.x add-on). For v1:
    IDLE while the app is open, plus reconnect/poll on foreground.
  - No offline sync/threading database — the app must persist messages itself
    (out of scope for v1; the agent works on live mail).
  - No Exchange/EWS. IMAP/SMTP only — fine for our model.

### Fallback if the library proves immature

Write a small custom native module wrapping **JavaMail for Android**
(well-trodden; a few hundred lines). Same shape, more work, no dependency risk.

### Provider presets (UX requirement)

| Provider | IMAP | SMTP | Auth |
|---|---|---|---|
| Gmail | imap.gmail.com:993 TLS | smtp.gmail.com:465 TLS | App password (IMAP must be enabled) |
| Outlook / M365 | outlook.office365.com:993 TLS | smtp.office365.com:587 STARTTLS | App password |
| Yahoo | imap.mail.yahoo.com:993 TLS | smtp.mail.yahoo.com:465 TLS | App password |
| iCloud | imap.mail.me.com:993 TLS | smtp.mail.me.com:587 STARTTLS | App-specific password |
| Custom/self-hosted | user-entered host:port | user-entered host:port | Password |

Ship this table in the app; "Custom" lets the user type host/port/security
manually.

---

## 3. What the APK needs (build checklist)

| Piece | How | Notes |
|---|---|---|
| Expo project | `npx create-expo-app` (SDK 53+, like `bro`) | New Architecture on by default |
| Email bridge | `react-native-mail-engine` | Requires dev build, not Expo Go |
| AI client | `fetch` to any OpenAI-compatible `/v1/chat/completions` | OpenRouter, OpenAI, DeepSeek, local — store base URL + key |
| Secure storage | `expo-secure-store` | App password + AI key, encrypted |
| Agent loop | TypeScript in-app: fetch mail → LLM → act | Skills + memory + multi-provider — see §3.2 |
| Screens | Today, Mail (inbox/thread/compose), Agent chat, Activity, Settings (email + providers + skills + memory) | See `mobile/MVP-UI.md` |
| Push | `expo-notifications` (local) | See §3.1 tradeoff |
| Build | **GitHub Actions** (`expo prebuild` + Gradle + Java 17) — the `bro` pattern | No EAS account needed; no Android SDK needed on Black site |
| Signing | `keytool` keystore (Java 17 present) → GitHub secret | Keep it safe; losing it = can't update |
| Distribution | Sideload APK first; Google Play ($25) later | Play needs privacy policy + data-safety form |

### 3.1 Honest tradeoffs of an on-device harness

1. **Autonomy vs. app-running.** The old Cloudflare design ran the agent 24/7
   server-side. On-device, the agent only works while the app is open (or a
   foreground service, which Android restricts). **v1:** run on open + on-demand
   + a periodic foreground check. This is a real product decision.
2. **Push notifications.** With no backend, true FCM push is impossible (someone
   must send it). **v1:** local notifications triggered by in-app/foreground
   checks. Real push would need a tiny relay (reintroduces a server) — defer.

---

### 3.2 Agent loop: skills, memory, multi-provider

The agent loop is the product. On-device it needs three subsystems:

**Skills** (standing instructions the user configures)
- Each skill = name + instruction + trigger + budget + quiet hours + shadow mode.
- Triggers: **schedule** (e.g. "clear the unread backlog each morning"),
  **event** (new mail arrives), or **manual**.
- Run while the app is open/foreground; a foreground service extends this
  (v1.x add-on). Kill switch + activity log are non-negotiable (port the old
  architecture's guardrails: kill switch, budgets, quiet hours, shadow/dry-run).
- MVP skills to ship first: **triage** (summarize new mail), **draft replies**,
  **follow-ups** (nag list). Same product question as the old roadmap, now
  on-device.

**Memory** (what the agent has seen and learned)
- Local store of threads, user facts, past decisions, preferences.
- MVP: `expo-sqlite` (or JSON) key-value + search. Later: on-device embeddings
  via the AI provider's embeddings endpoint for semantic recall.
- Memory is **per-device** in MVP — no cloud sync (keeps the "no server"
  promise).

**Multi-provider BYOK**
- Add **multiple** AI providers (OpenRouter, OpenAI, Anthropic, Gemini,
  DeepSeek, or any OpenAI-compatible custom endpoint).
- Each provider = name + base URL + API key + default model. Keys in
  SecureStore; a "test connection" button per provider.
- Pick a **primary** provider + model; optional per-skill model override.
- Optional fallback: if the primary fails, try the next configured provider.

---

## 4. Website → landing + download page

The frontend already has everything; it's a CTA swap, not a rebuild.

- `frontend/src/pages/Landing.jsx` has **4 "Get Started" CTAs** pointing at
  `/app` (lines ~129, 152, 312, 324). Replace them with a **"Download for
  Android"** button linking to the APK artifact.
- **Disable/remove** the `/app` and `/signin` routes (the app is no longer
  web-hosted). Keep the marketing sections (Capabilities, Millo, Security) —
  they now sell the *app*.
- **Host the APK** like `bro`: attach it to a **GitHub release** and link the
  latest release from the download button. Optionally show version + checksum.
- Strip or ignore the PWA bits — the site is now a static marketing page.

---

## 5. Desktop path (later) — easier than Android

The multiplatform goal maps cleanly onto the same TS core:

| Platform | Shell | Email (IMAP/SMTP) | Effort |
|---|---|---|---|
| **Android** | Expo + dev build | Native module (JavaMail) | Hard part (now) |
| **Windows .exe** | **Electron** (or Tauri) | **`nodemailer` + `imapflow`** — pure Node, work natively in Electron | Easy |
| **Linux AppImage** | Electron + electron-builder | Same as Windows | Easy |

Key insight: **Electron runs Node.js**, so the IMAP/SMTP problem that forces a
native module on Android **disappears on desktop** — `nodemailer` (SMTP) and
`imapflow` (IMAP) are battle-tested pure-JS libraries. And **Expo can export
the same RN UI to web** (`npx expo export --platform web`), which Electron then
wraps. Build the UI once in Expo; the desktop shell reuses it with a Node mail
layer.

- **Recommended:** Electron + electron-builder → `.exe` (Windows) + `.AppImage`
  (Linux). The `aide` project already ships desktop releases this way
  (desktop-v1.0.0, 9 assets) — the GitHub Actions release pattern is proven.
- **Alternative:** Tauri (Rust) — smaller binaries, but the mail layer must be
  written in Rust (`lettre`/`imap` crates) instead of reusing Node libs.
- **Shared core:** keep the agent loop + AI client + UI in a shared TS package
  so Android and desktop stay in sync.

---

## 6. Build order

1. **Scaffold the Expo app** — SDK 53, TypeScript, expo-router,
   secure-store, notifications.
2. **Email bridge spike** — integrate `react-native-mail-engine`, connect a
   Gmail app-password account, verify IMAP read + SMTP send on a dev build.
   **This is the risk gate — do it first.**
3. **BYOK AI client** + Settings screens (provider/model/key + email account).
4. **Agent loop v1** — triage/draft/follow-up against real mail, activity log,
   kill switch.
5. **CI build → signed APK** (GitHub Actions, `bro` pattern) → sideload test.
6. **Website → download page**, APK on a GitHub release.
7. *(Later)* **Electron desktop** reusing the Expo web export + `nodemailer`/
   `imapflow`.

---

## 7. Open questions (need user input to start)

- **Repo home:** new repo (e.g. `marvel-254/threadmymail-app`) or inside the
  existing `~/threadmymail`? Suggested: **new repo** for the app, keeping
  `~/threadmymail` as the marketing site.
- **Test email:** a Gmail account + app password to use as the test harness.
- **Keystore ownership:** who holds the signing keystore (Black site, or the
  user's machine)? It must be backed up somewhere safe.
- **Scope of v1 agent loop:** which skills ship first (triage? drafts?
  follow-ups?) — the same product question as the old roadmap, now on-device.
