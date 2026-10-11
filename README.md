# ThreadMyMail — Your AI Email Agent

> Not an email client with AI features. An autonomous inbox harness that runs
> entirely on your phone — your credentials never leave it, and there is no
> server, no account, and no subscription.

---

## What it is

ThreadMyMail (Millo) is an Android APK: a self-contained harness that holds your
email credentials (IMAP/SMTP + app password) and your AI key (BYOK), then runs
the agent loop **on-device**. No OAuth, no backend, no cloud dependency.

**What Millo does on your schedule:**
- Triage — clear the unread backlog, file, flag, archive
- Draft replies — in your voice, queued for one click
- Follow-ups — remind you (and optionally the sender) when threads go cold

**Every action lands in an activity log.** Reversible actions stay reversible.
The kill switch is always one tap away.

---

## Tech stack

| Layer | Choice |
|---|---|
| App | **Expo 57** (React Native, New Architecture) |
| Email | **react-native-mail-engine** (Nitro) — IMAP + SMTP via JavaMail/MailCore2 |
| AI | **BYOK** — any OpenAI-compatible endpoint (OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek, self-hosted) |
| Credentials | **expo-secure-store** — Android Keystore, never leaves the device |
| Local DB | **expo-sqlite** — cached message headers, no full bodies |
| Sync | **IMAP IDLE** — realtime push, 180-day history import |
| Build | **GitHub Actions** — Expo prebuild + Gradle, no EAS account |

---

## Building

### Prerequisites
- Node 20, Java 17
- A test email account with an app password (Gmail: myaccount.google.com → Security → App passwords)
- Optional: a signing keystore (generate with keytool; see below)

### Local development
```bash
cd mobile-app
npm install
npx expo prebuild --platform android   # generates android/
npx expo run:android                  # launches on a connected device/emulator
```

> react-native-mail-engine is a Nitro native module — it cannot run in Expo Go.
> Use a development build (npx expo run:android) or the CI release build.

### Release build (unsigned — fine for local testing)
```bash
cd mobile-app
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
# APK at: android/app/build/outputs/apk/release/app-release.apk
```

### Release build (properly signed, CI)

Set the following **GitHub Actions secrets**, then trigger the workflow:

| Secret | Value |
|---|---|
| THMMY_KEYSTORE_BASE64 | base64 -w0 threadmymail.keystore |
| THMMY_KEYSTORE_FILE | Filename, e.g. threadmymail.keystore |
| THMMY_KEYSTORE_PASSWORD | Keystore password |
| THMMY_KEY_ALIAS | Key alias |
| THMMY_KEY_PASSWORD | Key password |

The workflow publishes a GitHub Release with the signed APK automatically.

### Generate a signing keystore (first time)
```bash
keytool -genkey -v -keystore threadmymail.keystore \
  -alias threadmymail -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass <password> -keypass <password> \
  -dname "CN=ThreadMyMail, OU=ThreadMyMail, O=ThreadMyMail, L=Earth, C=US"
```

---

## Architecture

The APK is a harness. It holds your email credentials (IMAP/SMTP + app password)
and your AI key (BYOK), and runs the agent loop on-device.

- **Credentials** live in the OS keychain — Android Keystore-backed.
- **Agent loop** runs in the app's JS/TS layer: pull mail, call AI, act.
- **No backend dependency.** Works offline (except AI, which needs a network key).

---

## Docs

| Document | Purpose |
|---|---|
| mobile/MOBILE-STRATEGY.md | Authoritative product/architecture plan |
| mobile/MVP-UI.md | MVP UI design — screens, navigation, components |
| agent.md | Conventions for AI agents working in this repo |
| HANDOFF.md | Session handoff — current state and priorities |

---

## Status (2026-10-10)

The mobile harness is the product. The website is a landing + download page.

- APK builds with Expo + Gradle (CI: .github/workflows/android-build.yml)
- IMAP/SMTP bridge wired (src/lib/mailBridge.ts, src/lib/mailSync.ts)
- SMTP passthrough fixed — harness can send
- BYOK providers wired (src/lib/providerStore.ts, src/lib/emailTest.ts)
- Onboarding persists account + provider + onboarding flag (src/lib/prefs.ts)
- Settings: connect/disconnect email, add/remove/test providers, guardrails
- Signing plugin: plugins/withAndroidReleaseSigning.js (injects keystore config at prebuild)
- Provider store: src/lib/providerStore.ts (SecureStore-backed, testProvider / GET /models)

**Next:** real device test with a test Gmail app-password account.
