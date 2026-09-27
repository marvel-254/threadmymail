# ThreadMyMail - Planning Document

> Deep research & decision log for the personal AI email harness.

---

## 1. Problem Statement

I want a personal email client where **AI is the primary interface**, not an add-on. I provide my own API keys (BYOK) and the AI:
- Reads incoming mail
- Summarizes & triages
- Drafts replies
- Sends emails
- Schedules follow-ups
- Alerts me on important threads (push + email)

Host on Render. Build an Android APK. Single user (me).

---

## 2. Key Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| **Backend** | FastAPI (Python) | Native async, great for AI workers, easy on Render |
| **Email Protocol** | IMAP + SMTP (native) + Gmail/Outlook OAuth | Universal, supports any provider |
| **AI Integration** | Provider-agnostic via LiteLLM / OpenAI-compatible | BYOK: OpenAI, Anthropic, Ollama, custom base URL |
| **Database** | PostgreSQL (Render managed) | Reliable, free tier on Render |
| **Auth** | JWT + email-based magic links | No password storage, simple for single user |
| **Frontend (Web)** | React + Vite + Tailwind | Fast, familiar, deploys to Render static site |
| **Mobile** | React Native (Expo) → EAS Build → APK | Single codebase, push via Expo notifications |
| **Push Notifications** | Expo Push Service (free) | Works on Android without FCM complexity |
| **Scheduling** | APScheduler in worker process | Simple, no Celery/Redis needed for personal scale |
| **Email Fetch** | Background worker (cron + IMAP IDLE) | Real-time without webhooks |

---

## 3. Architecture Overview

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Mobile App │     │   Web Dashboard  │     │  Email (IMAP)│
│  (React     │     │   (React + Vite) │     │  Providers   │
│   Native)   │     │                  │     │  Gmail/Out/  │
└──────┬──────┘     └────────┬─────────┘     │  IMAP/SMTP   │
       │                     │               └──────┬───────┘
       │ HTTPS               │ HTTPS                    │
       ▼                     ▼                          ▼
┌────────────────────────────────────────────────────────────────┐
│                     RENDER SERVICE (FastAPI)                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────┐  │
│  │  API Routes │ │ AI Service  │ │ Email Sync  │ │Scheduler│  │
│  │  (REST)     │ │ (LiteLLM)   │ │ (IMAP/SMTP) │ │(APSched)│  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────┘  │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  PostgreSQL DB  │
                    │  (Render Managed)│
                    └─────────────────┘
```

---

## 4. Data Models

```python
# User (single, but designed for multi)
User:
  id, email, name, avatar_url, created_at
  ai_provider, ai_api_key, ai_base_url, ai_model
  notification_email, push_token

# Email Account (multi-account)
EmailAccount:
  id, user_id, provider, email, display_name
  imap_host, imap_port, smtp_host, smtp_port
  oauth_refresh_token (encrypted)
  password_encrypted (for app passwords)
  is_default, sync_enabled, last_synced_at

# Email Message
EmailMessage:
  id, account_id, message_id, thread_id
  subject, from_addr, to_addrs, cc_addrs
  body_text, body_html, snippet
  folder, flags (seen, flagged, answered)
  received_at, sent_at, synced_at
  ai_summary, ai_category, ai_priority

# AI Task / Scheduled Job
AITask:
  id, user_id, account_id, type (summarize, draft, send, remind)
  status (pending, running, done, failed)
  payload_json, result_json
  scheduled_at, started_at, completed_at
  error_message

# Notification
Notification:
  id, user_id, type (email, push, in_app)
  title, body, data_json
  read, sent_at, delivered_at
```

---

## 5. AI Capabilities (MVP)

| Capability | Trigger | Prompt Strategy |
|------------|---------|-----------------|
| **Summarize Thread** | On fetch / user request | "Summarize this thread in 3 bullets. Highlight action items." |
| **Smart Compose** | User clicks "AI Reply" | "Draft a reply to this email. Tone: professional but warm. Context: [user preferences]" |
| **Triage / Priority** | Background on new mail | "Score 1-10: urgency. Label: [important, newsletter, promo, spam, personal]" |
| **Extract Tasks** | User request | "Extract any tasks, deadlines, or commitments from this thread." |
| **Schedule Follow-up** | User: "Remind me in 2 days" | Creates AITask with scheduled_at |
| **Chat with Inbox** | User asks "Any emails from John about Q4?" | RAG over synced emails (vector search or SQL LIKE) |

---

## 6. BYOK Implementation

```python
# User config stored in DB (encrypted)
class AIConfig(BaseModel):
    provider: Literal["openai", "anthropic", "ollama", "custom"]
    api_key: str  # encrypted at rest
    base_url: Optional[str] = None  # for custom/OpenAI-compatible
    model: str = "gpt-4o-mini"
    temperature: float = 0.3
    max_tokens: int = 2000

# Runtime: inject into LiteLLM
completion = litellm.completion(
    model=f"{provider}/{model}",
    api_key=decrypt(user.ai_api_key),
    api_base=user.ai_base_url,
    messages=[...],
    temperature=user.ai_temperature,
)
```

**Supported Providers (OpenAI-compatible):**
- OpenAI, Anthropic (via LiteLLM), Groq, Together, Ollama, LM Studio, Custom

---

## 7. Email Sync Strategy

### Initial Sync
- Fetch last 30 days (configurable)
- Full sync on first connect

### Ongoing Sync
- **IMAP IDLE** for real-time (primary)
- **Cron every 5 min** as fallback
- Sync only `UNSEEN` + `FLAGGED` changes

### Folders to Sync
- INBOX (required)
- Sent (for thread context)
- Archive/All Mail (optional)
- User-selected labels/folders

---

## 8. Notification Flow

```
New Email Arrives
       │
       ▼
┌──────────────────┐
│ AI Triage Worker │────► Score >= 8? ──► Push Notification (Expo)
└──────────────────┘                    │
       │                               ▼
       ▼                    ┌──────────────────┐
┌──────────────────┐        │ Email Digest     │
│ Store in DB      │        │ (hourly/daily)   │
│ Create In-App    │        └──────────────────┘
│ Notification     │
└──────────────────┘
```

**Push Payload (Expo):**
```json
{
  "to": "ExponentPushToken[xxx]",
  "title": "📧 Important: John Doe",
  "body": "Re: Q4 Budget - Need your approval by EOD",
  "data": { "email_id": "msg_123", "account_id": "acc_456" },
  "sound": "default",
  "priority": "high"
}
```

---

## 9. API Endpoints (MVP)

### Auth
- `POST /auth/magic-link` - Send magic link
- `POST /auth/verify` - Verify token, return JWT
- `GET /auth/me` - Current user

### Accounts
- `GET /accounts` - List connected accounts
- `POST /accounts` - Add account (OAuth or IMAP/SMTP)
- `PUT /accounts/:id` - Update account
- `DELETE /accounts/:id` - Remove account
- `POST /accounts/:id/sync` - Manual sync trigger
- `POST /accounts/:id/test` - Test connection

### Emails
- `GET /emails` - List (pagination, filters: account, folder, unread, flagged)
- `GET /emails/:id` - Full email with thread
- `POST /emails/:id/read` - Mark read
- `POST /emails/:id/flag` - Toggle flag
- `POST /emails/:id/archive` - Move to archive
- `POST /emails/send` - Send email (with AI draft option)
- `POST /emails/draft` - Save draft

### AI
- `POST /ai/summarize` - Summarize thread/email
- `POST /ai/compose` - Generate reply draft
- `POST /ai/triage` - Re-triage inbox
- `POST /ai/chat` - Chat with inbox (RAG)
- `POST /ai/extract-tasks` - Extract action items

### Tasks & Scheduling
- `GET /tasks` - List scheduled tasks
- `POST /tasks` - Create task (reminder, follow-up, digest)
- `DELETE /tasks/:id` - Cancel task

### Notifications
- `GET /notifications` - List (push + in-app)
- `POST /notifications/read` - Mark read
- `POST /notifications/push-token` - Register Expo push token

### Settings
- `GET /settings` - Get user config
- `PUT /settings/ai` - Update AI provider/key/model
- `PUT /settings/notifications` - Notification preferences

---

## 10. Mobile App (React Native + Expo)

### Screens
1. **Onboarding** - Magic link login
2. **Accounts** - List + add email accounts
3. **Inbox** - Unified view, pull-to-refresh, swipe actions
4. **Thread View** - Full conversation, AI actions bar
5. **Compose** - New email + AI compose button
6. **AI Chat** - "Ask your inbox" interface
7. **Settings** - AI config, notifications, sync settings

### Key Libraries
- `expo` + `expo-router` (file-based routing)
- `expo-notifications` (push)
- `expo-secure-store` (token storage)
- `react-native-mmkv` (fast local cache)
- `react-query` / `tanstack-query` (server state)
- `nativewind` (Tailwind for RN)

### Build Pipeline
```bash
# Local dev
npx expo start

# Build APK (EAS)
eas build --platform android --profile preview

# Or: eas build --platform android --profile production
# Download .apk from Expo dashboard or install via QR
```

---

## 11. Render Deployment

### Services Required
1. **Web Service** - FastAPI backend (Python)
2. **Static Site** - React build output (optional, can serve from FastAPI)
3. **PostgreSQL** - Managed database
4. **Redis** (optional) - For rate limiting / future Celery

### render.yaml
```yaml
services:
  - type: web
    name: threadmymail-api
    env: python
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: DATABASE_URL
        fromDatabase: threadmymail-db
      - key: SECRET_KEY
        generateValue: true
      - key: ENCRYPTION_KEY
        generateValue: true
    healthCheckPath: /health

  - type: pserv
    name: threadmymail-db
    env: postgres
    plan: free

databases:
  - name: threadmymail-db
    plan: free
```

### Environment Variables (set in Render dashboard)
```
DATABASE_URL=postgresql://...
SECRET_KEY=...
ENCRYPTION_KEY=...
EXPO_PROJECT_ID=...
EXPO_ACCESS_TOKEN=...  # for push notifications
FRONTEND_URL=https://threadmymail.onrender.com
```

---

## 12. Security Considerations

| Risk | Mitigation |
|------|------------|
| API keys in DB | Encrypt with Fernet (ENCRYPTION_KEY) |
| Email passwords | App passwords only, encrypted |
| OAuth tokens | Encrypted, short-lived, refresh flow |
| Push tokens | Stored per-device, revocable |
| AI prompts | No logging of email content by default |
| Transport | HTTPS everywhere (Render provides) |
| CORS | Restrict to known origins |

---

## 13. Development Phases

### Phase 1: Core Backend (Week 1-2)
- [ ] FastAPI project setup
- [ ] PostgreSQL models + migrations (Alembic)
- [ ] JWT auth + magic links
- [ ] Email account CRUD + connection test
- [ ] IMAP sync worker (basic)
- [ ] SMTP send endpoint

### Phase 2: AI Integration (Week 2-3)
- [ ] LiteLLM integration with BYOK config
- [ ] Summarize endpoint
- [ ] Compose endpoint
- [ ] Triage background job
- [ ] Chat/RAG endpoint (simple SQL search first)

### Phase 3: Web Frontend (Week 3-4)
- [ ] React + Vite + Tailwind setup
- [ ] Auth flow (magic link)
- [ ] Account management UI
- [ ] Inbox list + thread view
- [ ] Compose modal with AI button
- [ ] Settings (AI config, notifications)

### Phase 4: Mobile App (Week 4-5)
- [ ] Expo project init
- [ ] Navigation + auth screens
- [ ] Inbox + thread view (shared components)
- [ ] Push notification setup (Expo)
- [ ] Offline-first cache (MMKV)
- [ ] EAS build config → APK

### Phase 5: Scheduling & Polish (Week 5-6)
- [ ] APScheduler integration
- [ ] Follow-up reminders
- [ ] Daily/weekly digest email
- [ ] Sync reliability (IDLE + cron)
- [ ] Error handling + logging
- [ ] Deploy to Render
- [ ] Build production APK

---

## 14. Open Questions

1. **Vector search for RAG?** Start with SQL `LIKE` + full-text search. Upgrade to pgvector if needed.
2. **OAuth vs App Passwords?** Support both. OAuth for Gmail/Outlook. App passwords for others.
3. **Attachment handling?** Store metadata in DB, download on-demand. Skip storing blobs initially.
4. **Encryption key rotation?** Use envelope encryption: DEK per user, KEK in env.
5. **Rate limiting AI?** Per-user token budget in DB, reset daily.

---

## 15. Estimated Costs (Monthly)

| Service | Free Tier | Paid Estimate |
|---------|-----------|---------------|
| Render Web Service | ✅ Free | $7/mo (Starter) |
| Render PostgreSQL | ✅ Free (90 days) | $7/mo |
| Expo Push | ✅ Free | Free |
| EAS Build | ✅ 30 builds/mo | $29/mo |
| AI API (BYOK) | Your keys | Your cost |

**Total: $0-14/mo** for personal use on free tiers.

---

## 16. Next Steps

1. Initialize git repo in `/home/marvel/me/threadmymail`
2. Create backend FastAPI skeleton
3. Set up PostgreSQL models + Alembic
4. Implement magic link auth
5. Build first IMAP sync
6. Test end-to-end: add account → sync → view → AI summarize → send

---

*Last updated: 2026-09-27*
*Status: Planning complete → Ready for implementation*
---

## 19. Plan Refinements (2026-09-27 - User Updates)

> The plan is intentionally kept "misty." No code is being written yet. We are clarifying requirements, not building.

### 19.1 AI Provider Updates

**Top Tier (Paid / Premium):**
- OpenAI (GPT-4o / GPT-4o-mini / GPT-3.5)
- Anthropic Claude (Haiku / Sonnet / Opus)
- Google Gemini (Pro / Ultra / Flash)
- Mistral AI (Large / Small / Medium)
- Cohere Command / Embed
- Amazon Bedrock (Claude / Llama / Mistral)

**Free Tier (No payment / Generous limits):**
- Ollama (Local / Free)
- Groq (Free tier: 1 request/min)
- Together AI (Free tier available)
- LM Studio (Local, free)
- Perplexity API (Free tier available)
- DeepSeek (Free tier available)
- Google Gemini (Free tier: 1,500 requests/day)
- OpenAI (Free tier: limited but available for new accounts)
- Meta Llama (via Replicate / local)
- Hugging Face Inference API (Free tier)

**Total:** 10+ providers available. BYOK allows user to plug in any.

### 19.2 Email Provider Updates (Confirmed)
- **Gmail** (OAuth + App Password + IMAP) — Primary
- **Outlook / Microsoft 365** — Secondary
- **Generic IMAP/SMTP** — Optional for testing / custom

No other providers required for MVP.

### 19.3 Mobile / Android Decisions
- **Local Android Emulator:** NOT available (no SDK installed, no emulator binary)
- **Approach:** Expo Go (development) + EAS Build (production APK) only
- **Physical device testing:** Recommended for real push notifications
- **No local emulator dependency:** This avoids setup complexity

### 19.4 PWA Addition
- A Progressive Web App version is added to the plan
- Built from the same React frontend (Vite + PWA plugin)
- Runs in browser: installable on Android/Apple via "Add to Home Screen"
- Works alongside mobile APK — user can choose
- Offline capable via service workers
- Push notifications via Web Push (not Expo Push — separate channel)

### 19.5 Plan Status: MISTY (Not Concrete Yet)
- No Git repo initialized
- No backend skeleton created
- No mobile code written
- Only documentation exists
- We are clarifying, not building

### 19.6 Decision Priority (Pending)
1. **AI Provider Strategy:** Which providers will you use? (OpenAI vs Anthropic vs local?)
2. **Mobile Testing:** Will you test on a physical device with Expo Go, or install Android SDK later?
3. **PWA vs APK:** Will you prioritize PWA (quick, browser-based) vs native APK (full-featured)?
4. **Backend Infrastructure:** Render vs self-hosted vs hybrid?

---

## 20. Scenarios

### Scenario A: Quick Start (Week 1-2)
- Use existing OpenAI / Google Gemini (free tiers)
- Only Gmail OAuth + App Password
- Web PWA first, mobile APK second
- Deploy to Render immediately

### Scenario B: Full Control (Week 1-3)
- Set up Ollama locally (optional)
- Add Anthropic / OpenAI API keys
- Gmail + Outlook + IMAP
- PWA + Android APK both in parallel
- Hybrid hosting: Render backend, local mobile build

### Scenario C: Testing Phase (Week 1-4)
- Create Git repo
- Install Docker locally (optional)
- Use local PostgreSQL + Render backup
- Test everything on localhost
- Push to Render when ready

### Scenario D: Launch (Week 3-4)
- Deploy Render (web backend)
- Build PWA and deploy
- Build Android APK via EAS
- Physical device testing
- User onboarding and feedback

---

## 21. Technical Tools

### 21.1 For Local Development
- **Node.js 18+** (for React / Expo)
- **PostgreSQL 14+** (local)
- **Docker** (optional for isolated env)
- **EAS CLI** (already available)
- **GitHub** (for repo, CI)

### 21.2 Required Extensions for Workflow
- **expo-notifications** (Push)
- **react-native-mmkv** (Fast storage)
- **tailwindcss** (Styling)
- **expo-secure-store** (Sensitive data)
- **expo-router** (File-based routing)
- **@react-navigation/native-stack** (Navigation)
- **react-query** (Server state)

---

## 22. Estimated Timeline with Clarifications

### 22.1 With Refinement Phase (Week 0)
- **Week 0:** Clarify providers, set up Git, initial skeleton
- **Week 1-2:** Build backend with chosen providers
- **Week 3-4:** Web frontend + PWA
- **Week 5-6:** Mobile (Expo Go) + push notifications
- **Week 7-8:** Render deployment, APK build
- **Week 9-10:** Testing, polish, documentation

### 22.2 Quick Start (If confident)
- **Week 1-2:** Complete version
- **Week 3:** Deploy to Render
- **Week 4:** APK + PWA ready

---

## 23. Final Decision Points

| Question | Priority | Impact |
|----------|----------|--------|
| AI providers selection | HIGH | Determines user experience |
| Email providers scope | HIGH | Limits account connections |
| PWA vs APK priority | MEDIUM | Determines user options |
| Development environment | MEDIUM | Setup complexity |

**Next:** User needs to answer these to proceed beyond planning.

---

*This planning document reflects user refinements and keeps the approach "misty."*
*Last updated: 2026-09-27*

---

## 24. Final User Decisions (2026-09-27)

Based on the user's confirmation:

### AI Provider
- **OpenRouter** (https://openrouter.ai)
  - Provides unified API to access hundreds of models (OpenAI, Anthropic, Google, Mistral, Llama, etc.)
  - BYOK: User provides OpenRouter API key
  - Base URL: `https://openrouter.ai/api/v1`
  - Model selection: User can choose any model available on OpenRouter
  - Benefits: Single key for many providers, fallback options, competitive pricing

### Mobile & Development Workflow
- **Android device for Expo Go testing**: User has a device with Expo Go installed
- **PWA first, then APK**: Progressive Web App will be built and deployed before the native Android APK
- **Render from day one**: Backend will be deployed to Render immediately; local development will be minimal
- **Git workflows for CI/CD**: Use GitHub Actions to offload builds/tests due to limited local RAM/CPU
  - Build frontend (PWA) on CI and deploy to Render static site or similar
  - Run backend tests on CI
  - Build Android APK via EAS in GitHub Actions (optional)
  - Deploy to Render on push to main

### Local Development Minimization
Given limited local resources:
- Local PostgreSQL optional (can use Render's free tier from day one)
- Local Node.js only for frontend dev (can use GitHub Codespaces if needed)
- Backend dev primarily via Render logs and CI
- Use `git push` to trigger Render builds

### Implementation Adjustments

#### Backend Changes for OpenRouter
- Add OpenRouter as a supported provider in LiteLLM configuration
- Base URL: `https://openrouter.ai/api/v1`
- Auth: Bearer token from user-provided API key
- Model: User-selectable (e.g., `openrouter/anthropic/claude-3.5-sonnet`, `openrouter/openai/gpt-4o`, etc.)

#### PWA First Approach
- Frontend will be built as a PWA using Vite + PWA plugin
- Deployed to Render static site (or Netlify fallback)
- Installable via "Add to Home Screen"
- Push notifications via Web Push (VAPID)

#### APK Second Approach
- After PWA is stable, build Android APK via EAS Build
- Use the same Expo Go-tested code
- Submit to internal testing or direct install

#### Git Workflow Example
```yaml
# .github/workflows/ci.yml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
      - run: pip install -r backend/requirements.txt
      - run: pytest backend/tests/
  build-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run build --prefix frontend
      - uses: peaceiris/actions-gh-pages@v3  # or deploy to Render static site
  notify:
    needs: [test-backend, build-frontend]
    runs-on: ubuntu-latest
    steps:
      - uses: slackapi/slack-github-action@v1.23.0
        with:
          payload: |
            {
              "text": "ThreadMyMail CI passed: ${{ github.sha }}"
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

---

## 25. Updated Timeline with Decisions

### Week 0: Setup
- Initialize Git repo
- Set up Render account, PostgreSQL, web service
- Configure OpenRouter API key (user provides)
- Create GitHub repo, enable Actions
- Write backend skeleton

### Week 1-2: Backend Foundation
- FastAPI + PostgreSQL models + migrations
- JWT auth + magic link
- Email account CRUD (Gmail/Outlook/IMAP)
- IMAP sync worker (APScheduler)
- OpenRouter AI service integration
- Deploy to Render, verify health

### Week 3-4: PWA Frontend
- React + Vite + PWA plugin
- Auth flow (magic link)
- Inbox dashboard, thread view
- Compose with AI suggestions (via OpenRouter)
- Settings (AI model selection, notifications)
- Deploy PWA to Render static site
- Test on device via browser

### Week 5-6: Mobile App (Expo Go)
- Clone web frontend code to React Native (Expo)
- Share components/hooks via monorepo or npm package
- Push notifications via Expo (separate from PWA Web Push)
- Test on user's Android device via Expo Go
- Adjust UI for mobile

### Week 7-8: Android APK & Polish
- EAS Build: `eas build --platform android --profile preview`
- Internal testing, install APK
- Background workers refinement
- Error handling, logging
- Final Render scaling (if needed)

### Week 9-10: Launch & Feedback
- User onboarding flow
- Documentation updates
- Optional: Add more AI models via OpenRouter
- Optional: Add Outlook OAuth

---

## 26. Local Development Notes (for Reference)

Despite focusing on Render, here's what might be needed locally for quick tweaks:

```bash
# Prerequisites (install once)
# - Node.js 18+
# - Python 3.11+
# - PostgreSQL (optional, can skip if using Render)
# - Git
# - Expo CLI (for mobile dev: npm i -g expo-cli)

# Local dev (if desired)
cd threadmymail/backend
uvicorn app:app --reload  # points to Render DB via env var?

cd ../frontend
npm run dev  # Vite dev server

cd ../mobile
npx expo start  # Scan with Expo Go on device
```

But the goal is to minimize local work and use Render/GitHub Actions.

---
*Plan updated with user's final decisions: OpenRouter, PWA first, Render from day one, git workflows for CI.*
*Last updated: 2026-09-27*
