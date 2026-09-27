# ThreadMyMail - AI Email Harness

> Personal AI-powered email management platform. BYOK (Bring Your Own Key). Host on Render. Android APK with push notifications.

## Quick Links

- [Agent Guide & Prototype](./agent.md) - UI prototype & agent rules
- [Planning Docs](./docs/PLANNING.md) - Project roadmap & decisions
- [Tech Spec](./docs/SPEC.md) - Technical specification
- [Architecture](./docs/ARCHITECTURE.md) - System architecture & data flow
- [API Routes](./docs/API.md) - Endpoint definitions
- [Render Deploy](./hosting/RENDER.md) - Hosting guide
- [APK Build](./mobile/APK.md) - Android build guide

## Core Principle

> "A simple Gmail-like UI, but your AI co-pilot reads, writes, schedules and watches your inbox."

## Features

- Multi-account email (Gmail, Outlook, IMAP/SMTP)
- AI summarization & smart compose
- Schedule tasks & email reminders
- Push notifications (mobile) + email notifications
- BYOK: plug in your own API key or use default providers
- Render hosting + Android APK

## Project Structure

```
threadmymail/
├── backend/          # FastAPI + email workers
├── mobile/           # React Native Android APK
├── hosting/          # Render configs & Docker
├── docs/             # Planning & API docs
└── README.md
```
