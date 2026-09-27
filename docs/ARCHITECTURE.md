# ThreadMyMail - Architecture Documentation

> System overview, data flow, and component relationships.

---

## 1. High-Level Architecture

**Pattern:** Modular Monolith with Clear Bounded Contexts

### Core Services
1. **Authentication Service** - JWT + magic links
2. **Account Service** - Email connections (IMAP/SMTP, OAuth)
3. **Email Service** - Sync, storage, parsing
4. **AI Service** - LLM orchestration, prompts, completions
5. **Task Service** - Scheduling, jobs, follow-ups
6. **Notification Service** - Push + email alerts
7. **Web UI** - React dashboard

---

## 2. Data Flow (Sync Path)

```mermaid
graph TD
    A[User] --> B[Web UI/React Native]
    B --> C[Backend API (FastAPI)]
    C --> D[Email Sync Worker]
    D --> E[Email Accounts (IMAP)]
    E --> F[Database (PostgreSQL)]
    F --> G[AI Service]
    G --> H[Vector Store (optional)]
    C --> I[AI Endpoints]
    I --> J[AI Worker Process]
    J --> K[AI Results]
    K --> F
```

---

## 3. Technical Stack

### Backend (Python FastAPI)
```python
# Core Dependencies
fastapi>=0.104.1
uvicorn[standard]>=0.24.1
litellm>=1.40.0        # OpenAI-compatible gateway
psycopg2-binary>=2.9
pydantic>=2.5
python-jose[cryptography]>=3.3
passlib[bcrypt]>=1.4
pycryptodome>=3.19
APScheduler>=3.10
smtplib, email, imaplib  # Standard library

# Optional
pgvector>=0.2.0
redis>=5.0
```

### Database Schema Design

**User Table**
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    ai_provider VARCHAR(50) DEFAULT 'openai',
    ai_model VARCHAR(100) DEFAULT 'gpt-4o-mini',
    ai_api_key_encrypted TEXT,  -- encrypted at rest
    ai_base_url TEXT,
    notification_email VARCHAR(255),
    push_token TEXT,
    theme VARCHAR(20) DEFAULT 'system',
    timezone VARCHAR(50) DEFAULT 'UTC'
);
```

**Email Account Table**
```sql
CREATE TABLE email_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,  -- 'gmail', 'outlook', 'custom'
    email_address VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    
    -- Connection details (encrypted as needed)
    imap_host VARCHAR(255),
    imap_port INTEGER DEFAULT 993,
    imap_encryption VARCHAR(10) DEFAULT 'ssl',
    imap_username_encrypted TEXT,  -- app password
    
    smtp_host VARCHAR(255),
    smtp_port INTEGER DEFAULT 587,
    smtp_encryption VARCHAR(10) DEFAULT 'tls',
    smtp_username_encrypted TEXT,
    
    -- OAuth support
    oauth_provider VARCHAR(50),
    oauth_access_token_encrypted TEXT,
    oauth_refresh_token_encrypted TEXT,
    oauth_token_expiry TIMESTAMP,
    
    is_default BOOLEAN DEFAULT FALSE,
    folder_mapping JSONB DEFAULT '{}',
    sync_enabled BOOLEAN DEFAULT TRUE,
    last_synced_at TIMESTAMP,
    next_sync_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**Email Message Table**
```sql
CREATE TABLE email_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
    message_id VARCHAR(255) UNIQUE,  -- RFC Message-ID
    thread_id VARCHAR(255),          -- Gmail/Outlook threading
    
    subject TEXT,
    from_address VARCHAR(255),
    from_name VARCHAR(255),
    to_addresses JSONB,              -- Array of email objects
    cc_addresses JSONB,
    bcc_addresses JSONB,
    
    body_text TEXT,
    body_html TEXT,
    snippet TEXT,                    -- Short preview
    
    folder VARCHAR(100) DEFAULT 'inbox',
    flags INTEGER DEFAULT 0,          -- 0=seen, 1=flagged, 2=answered
    
    received_at TIMESTAMP NOT NULL,
    sent_at TIMESTAMP,
    
    -- AI processing results
    ai_summary TEXT,
    ai_category VARCHAR(50),         -- 'personal', 'work', 'newsletter', 'promo', 'spam'
    ai_priority INTEGER DEFAULT 0,    -- 1-10 urgency score
    ai_embedding VECTOR(1536),       -- Optional: pgvector for RAG
    
    synced_at TIMESTAMP DEFAULT NOW()
);
```

**AI Task Table**
```sql
CREATE TABLE ai_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES email_accounts(id) ON DELETE SET NULL,
    
    task_type VARCHAR(50) NOT NULL,  -- 'summarize', 'compose', 'triage', 'chat', 'extract_tasks'
    task_status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed'
    
    input_data JSONB,                -- Email IDs, thread, context
    input_prompt TEXT,               -- Generated prompt for LLM
    
    result_data JSONB,               -- AI output (summary, draft, etc.)
    error_message TEXT,
    
    scheduled_at TIMESTAMP NOT NULL,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3
);
```

**Notification Table**
```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    type VARCHAR(20) NOT NULL,       -- 'push', 'email', 'in_app'
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB,                      -- Email ID, account ID, etc.
    
    read BOOLEAN DEFAULT FALSE,
    delivered BOOLEAN DEFAULT FALSE,
    
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 4. Component Details

### 4.1 Email Sync Service

**Connection Pooling**
```python
class EmailConnectionManager:
    def __init__(self, db_pool):
        self.connections = {}
        self.db = db_pool
    
    async def sync_account(self, account_id):
        account = await self.get_account(account_id)
        
        # IMAP connection
        if account.imap_username_encrypted:
            username = decrypt(account.imap_username_encrypted)
            conn = imaplib.IMAP4_SSL(account.imap_host, account.imap_port)
            conn.login(username, decrypt_password())
            
            # Select mailbox
            conn.select(account.folder_mapping.get('inbox', 'INBOX'))
            
            # Fetch unseen messages
            _, messages = conn.search(None, 'UNSEEN')
            
            for msg_id in messages[0].split():
                # Parse and store email
                await self.process_message(msg_id, conn, account_id)
        
        # Update last synced time
        await self.update_sync_time(account_id)
```

**Message Processing**
```python
class EmailProcessor:
    def __init__(self, ai_service, db):
        self.ai = ai_service
        self.db = db
    
    async def process_message(self, msg_data, account_id):
        # Parse RFC 5322 message
        email_msg = email.message_from_string(msg_data)
        
        # Extract headers
        subject = email_msg['Subject']
        from_addr = email_msg['From']
        to_addrs = email_msg['To']
        date_str = email_msg['Date']
        
        # Parse date
        parsed_date = email.utils.parsedate_to_datetime(date_str)
        
        # Extract body
        body_text = self.extract_text_body(email_msg)
        body_html = self.extract_html_body(email_msg)
        snippet = body_text[:200] + '...' if len(body_text) > 200 else body_text
        
        # Store in database
        email_id = await self.db.insert_email({
            'account_id': account_id,
            'subject': subject,
            'from_address': from_addr,
            'to_addresses': to_addrs,
            'body_text': body_text,
            'body_html': body_html,
            'snippet': snippet,
            'received_at': parsed_date,
            'flags': 0
        })
        
        # Trigger AI processing
        await self.trigger_ai_triage(email_id, body_text, subject)
        
        return email_id
```

### 4.2 AI Service with BYOK

**Provider Abstraction**
```python
class AIService:
    def __init__(self, db, redis):
        self.db = db
        self.redis = redis
        self.providers = {
            'openai': OpenAIManager,
            'anthropic': AnthropicManager,
            'ollama': OllamaManager,
            'custom': CustomManager
        }
    
    async def get_completion(self, user_id, messages, options=None):
        # Get user AI config
        user = await self.db.get_user(user_id)
        config = user.ai_config
        
        # Initialize provider manager
        provider = self.providers.get(config.provider)
        manager = provider(
            api_key=config.api_key,
            base_url=config.base_url,
            model=config.model,
            temperature=config.temperature
        )
        
        # Rate limiting check
        await self.check_rate_limit(user_id)
        
        # Generate completion
        return await manager.complete(messages, options)
    
    async def summarize_thread(self, email_ids, user_id):
        # Get emails from database
        emails = await self.db.get_emails(email_ids)
        thread_text = '\n\n'.join([
            f"From: {e['from_address']}\nSubject: {e['subject']}\nBody: {e['body_text'][:500]}"
            for e in emails
        ])
        
        prompt = f"""Summarize this email thread:
{thread_text}

Provide:
1. Main purpose/purpose
2. Key action items
3. Who needs to do what
3. Priority level (1-10)"""
        
        result = await self.get_completion(user_id, [{'role': 'user', 'content': prompt}])
        return result['content']
```

**AI Prompt Templates**
```python
class PromptTemplates:
    SUMMARIZE_THREAD = """
Context: This is an email thread between {participants}.

Purpose: {subject}

Key points:
{key_points}

Action items:
{actions}

Please provide:
1. Main purpose and decisions
2. Outstanding action items with owners
3. Priority level (1-10) and why
4. Any risks or deadlines
"""
    
    SMART_COMPOSE = """
Write a draft reply to this email:

---
To: {to_addresses}
Subject: {subject}
Original message:
{original_message}

Context:
- Relationship: {relationship_type}
- Tone: {desired_tone}
- Key points to include: {key_points}
- What I want to achieve: {goal}

Please write a {length} reply that:
1. Acknowledges the email
2. Addresses the main points
3. Includes any necessary action items
4. Maintains appropriate tone
"""
```

### 4.3 Notification Service

**Push Notifications (Expo)**
```python
class PushNotificationService:
    def __init__(self, expo_project_id, access_token):
        self.project_id = expo_project_id
        self.access_token = access_token
        self.base_url = "https://exp.host/--/api/v2/push/send"
    
    async def send_push(self, user_id, title, body, data=None):
        # Get user's push token
        user = await self.db.get_user(user_id)
        if not user.push_token:
            return False
        
        payload = {
            "to": user.push_token,
            "title": title,
            "body": body,
            "data": data or {},
            "sound": "default",
            "priority": "high",
            "ttl": 3600
        }
        
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer {self.access_token}"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(self.base_url, json=payload, headers=headers) as resp:
                result = await resp.json()
                return result.get('data', {}).get('status') == 'ok'
```

**Email Notifications**
```python
class EmailNotificationService:
    def __init__(self, email_service):
        self.email = email_service
    
    async def send_digest(self, user_id, emails):
        user = await self.db.get_user(user_id)
        if not user.notification_email:
            return False
        
        subject = f"📧 Daily Digest: {len(emails)} new emails"
        body = self.generate_digest_html(emails)
        
        await self.email.send(
            from_addr=user.notification_email,
            to_addrs=[user.notification_email],
            subject=subject,
            body_html=body
        )
        
        return True
```

---

## 5. Scheduling & Background Jobs

### APScheduler Configuration
```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger

class TaskScheduler:
    def __init__(self, db, email_service, ai_service):
        self.scheduler = AsyncIOScheduler()
        self.db = db
        self.email_service = email_service
        self.ai_service = ai_service
        self.register_jobs()
    
    def register_jobs(self):
        # Sync accounts every 5 minutes
        self.scheduler.add_job(
            self.sync_all_accounts,
            trigger=IntervalTrigger(minutes=5),
            id='sync_accounts',
            replace_existing=True
        )
        
        # AI triage for new emails
        self.scheduler.add_job(
            self.triage_new_emails,
            trigger=IntervalTrigger(minutes=10),
            id='triage_emails',
            replace_existing=True
        )
        
        # Daily digest
        self.scheduler.add_job(
            self.send_daily_digest,
            trigger=CronTrigger(hour=20, minute=0),
            id='daily_digest',
            replace_existing=True
        )
        
        # AI summarization jobs
        self.scheduler.add_job(
            self.process_ai_tasks,
            trigger=IntervalTrigger(seconds=30),
            id='process_ai_tasks',
            replace_existing=True
        )
        
        self.scheduler.start()
    
    async def sync_all_accounts(self):
        accounts = await self.db.get_accounts_to_sync()
        for account in accounts:
            try:
                await self.email_service.sync_account(account['id'])
            except Exception as e:
                print(f"Sync failed for account {account['id']}: {e}")
    
    async def triage_new_emails(self):
        new_emails = await self.db.get_unread_emails()
        for email in new_emails:
            await self.ai_service.trigger_triage(email['id'], email['body_text'])
    
    async def process_ai_tasks(self):
        pending_tasks = await self.db.get_pending_tasks()
        for task in pending_tasks:
            await self.process_task(task)
```

---

## 6. Security & Encryption

### Fernet Encryption
```python
from cryptography.fernet import Fernet

class EncryptionService:
    def __init__(self):
        # Key from environment
        self.key = os.getenv('ENCRYPTION_KEY')
        self.cipher_suite = Fernet(self.key)
    
    def encrypt(self, data: str) -> str:
        return self.cipher_suite.encrypt(data.encode()).decode()
    
    def decrypt(self, encrypted_data: str) -> str:
        return self.cipher_suite.decrypt(encrypted_data.encode()).decode()
```

### Password Hashing
```python
from passlib.context import CryptContext

class AuthService:
    def __init__(self):
        self.pwd_context = CryptContext(schemes=["bcrypt"], deprecated=["auto"])
    
    def hash_password(self, password: str) -> str:
        return self.pwd_context.hash(password)
    
    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        return self.pwd_context.verify(plain_password, hashed_password)
```

---

## 7. Monitoring & Observability

### Health Check Endpoint
```python
@app.get("/health")
async def health_check():
    status = {
        "status": "healthy",
        "timestamp": datetime.utcnow(),
        "services": {}
    }
    
    # Check database
    try:
        await db.execute("SELECT 1")
        status["services"]["database"] = "healthy"
    except Exception as e:
        status["services"]["database"] = f"unhealthy: {e}"
    
    # Check Redis
    try:
        await redis.ping()
        status["services"]["redis"] = "healthy"
    except Exception as e:
        status["services"]["redis"] = f"unhealthy: {e}"
    
    return status
```

---

## 8. Performance Considerations

### Connection Pooling
```python
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

# Database
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL, poolclass=NullPool)

# Email connections (per account)
class EmailConnectionPool:
    def __init__(self, max_connections=5):
        self.max_connections = max_connections
        self.available = asyncio.Queue(maxsize=max_connections)
        
        for _ in range(max_connections):
            self.available.put_nowait(self.create_connection())
    
    async def get_connection(self, account_id):
        # Get connection for specific account
        conn = await self.available.get()
        return conn
```

### Caching
```python
from functools import lru_cache
import redis.asyncio as redis

class CacheService:
    def __init__(self, redis_url):
        self.redis = redis.from_url(redis_url)
    
    async def get(self, key):
        return await self.redis.get(key)
    
    async def set(self, key, value, ttl=None):
        if ttl:
            await self.redis.setex(key, ttl, value)
        else:
            await self.redis.set(key, value)
    
    async def delete(self, key):
        await self.redis.delete(key)
```

---

## 9. Future Enhancements

### Scalability Features
- [ ] Message Queue (Redis + Celery) for heavy AI processing
- [ ] Database sharding for large users
- [ ] WebSocket support for real-time updates
- [ ] Multi-region deployment
- [ ] Advanced RAG with vector search (pgvector)
- [ ] AI model fine-tuning (local LLMs)
- [ ] Custom email domains
- [ ] Integration with external calendars

### Mobile Enhancements
- [ ] Native Android notifications
- [ ] Offline-first sync
- [ ] File attachments viewer
- [ ] Biometric login
- [ ] Deep link support
- [ ] Push notification channels

---

## 10. Deployment Checklist

### Render
- [ ] Upload render.yaml
- [ ] Configure PostgreSQL addon
- [ ] Set environment variables
- [ ] Configure custom domain
- [ ] Set up health check monitoring
- [ ] Configure logging

### Android APK
- [ ] Configure EAS build profile
- [ ] Set up push notification certificates
- [ ] Configure Firebase credentials
- [ ] Set up app signing
- [ ] Test on physical device
- [ ] Publish to internal test track

---

## 11. Compliance & Privacy

- **Data Storage**: All user data encrypted at rest
- **Email Access**: Only IMAP/SMTP credentials stored encrypted
- **AI Prompts**: No email content stored by default (processing in-memory)
- **Retention**: Users can export/delete data anytime
- **Compliance**: GDPR-friendly design (no PII beyond email)

---

*This architecture document is a living document. Update as design decisions evolve.*

*Last updated: 2026-09-27*
---

## 13. PWA Architecture (New Addition)

### Progressive Web App
The PWA is built from the **same React codebase** as the web dashboard using Vite's PWA plugin.

**Architecture:**
```
┌─────────────────────────────────────────────────────────────┐
│                      React App (Vite)                        │
├─────────────────────────────────────────────────────────────┤
│  Components (shared): Inbox, Thread, Compose, AI Chat       │
│  Hooks (shared): useEmail, useAI, useNotifications          │
│  API Client: TanStack Query + Axios                         │
└─────────────────────────────────────────────────────────────┘
                          │
           ┌──────────────┴──────────────┐
           ▼                             ▼
   ┌───────────────┐             ┌───────────────┐
   │   Web App     │             │     PWA       │
   │  (Desktop)    │             │  (Installable)│
   │  - Service    │             │  - Service    │
   │    Worker     │             │    Worker     │
   │  - IndexedDB  │             │  - IndexedDB  │
   │  - Web Push   │             │  - Web Push   │
   └───────────────┘             └───────────────┘
```

### PWA Features
| Feature | Implementation |
|---------|----------------|
| **Installable** | Manifest + Service Worker |
| **Offline** | Workbox caching (emails, UI) |
| **Push** | Web Push API (VAPID keys) |
| **Background Sync** | Sync emails when online |
| **App Shell** | Cached static assets |
| **Responsive** | Mobile-first Tailwind |

### Vite PWA Config
```javascript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'ThreadMyMail',
        short_name: 'ThreadMail',
        description: 'AI-powered email management',
        theme_color: '#3b82f6',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.threadmymail\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 3600 },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
});
```

### Web Push Notifications
```typescript
// lib/push-web.ts
export async function registerWebPush() {
  if (!('serviceWorker' in navigator)) return;
  
  const registration = await navigator.serviceWorker.register('/sw.js');
  const permission = await Notification.requestPermission();
  
  if (permission !== 'granted') return;
  
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: import.meta.env.VITE_VAPID_PUBLIC_KEY,
  });
  
  // Send to backend
  await fetch('/api/notifications/web-push', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}
```

### Mobile Architecture Update (No Local Emulator)
```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile Strategy                            │
├─────────────────────────────────────────────────────────────┤
│  NO local Android emulator / SDK                             │
│                                                               │
│  Development: Expo Go (physical device)                     │
│    - Scan QR code from `npx expo start`                     │
│    - Hot reload over WiFi                                    │
│    - Real push notifications via Expo                       │
│                                                               │
│  Production: EAS Build (cloud)                               │
│    - `eas build --platform android --profile preview`       │
│    - Download APK from Expo dashboard                        │
│    - Install via `adb` or file transfer                      │
│                                                               │
│  PWA Alternative:                                            │
│    - Open https://threadmymail.onrender.com                 │
│    - "Add to Home Screen" → App-like experience             │
│    - Web Push for notifications                              │
└─────────────────────────────────────────────────────────────┘
```

### Email Provider Support Matrix (Confirmed)
| Provider | Auth Method | Protocols | Status |
|----------|-------------|-----------|--------|
| **Gmail** | OAuth 2.0 / App Password | IMAP / SMTP | ✅ Primary |
| **Outlook** | OAuth 2.0 / App Password | IMAP / SMTP | ✅ Secondary |
| **Yahoo** | App Password | IMAP / SMTP | ⚠️ Generic IMAP |
| **Custom / Proton / Zoho** | App Password | IMAP / SMTP | ⚠️ Generic IMAP |
| **Fastmail** | App Password | IMAP / SMTP | ⚠️ Generic IMAP |

---

## 14. Free Tier AI Providers (10+)

### Local / Self-Hosted (Free)
| Provider | Models | Setup | Best For |
|----------|--------|-------|----------|
| **Ollama** | Llama 3, Gemma, Mistral, CodeLlama | `ollama serve` | Full privacy, offline |
| **LM Studio** | Any GGUF model | GUI download | Local experimentation |
| **Llama.cpp** | Any GGUF model | CLI / Python | Minimal resources |

### Cloud Free Tiers (API Key Required)
| Provider | Free Tier Limits | Models | Notes |
|----------|------------------|--------|-------|
| **Groq** | 1 req/min, 14.4k tokens/day | Llama 3, Mixtral, Gemma | Ultra-fast inference |
| **Together AI** | $1 free credit | Llama, Mixtral, Qwen | Open models |
| **DeepSeek** | Free tier available | DeepSeek-Coder, Chat | Code-specialized |
| **Perplexity** | Free tier available | Llama 3, Sonar | Search-augmented |
| **Hugging Face** | 30k tokens/month | 1000s of models | Inference API |
| **Google Gemini** | 1.5k req/day | Gemini Pro, Flash | Google AI Studio |
| **OpenAI** | New accounts: $5 credit | GPT-4o-mini, 3.5 | Limited free tier |
| **NVIDIA** | Free tier available | Nemotron, Llama | Fast inference |

### BYOK Implementation (Updated)
```python
# backend/ai_service.py
AI_PROVIDERS = {
    # Top tier
    "openai": {"base_url": "https://api.openai.com/v1", "requires_key": True},
    "anthropic": {"base_url": "https://api.anthropic.com", "requires_key": True},
    "google": {"base_url": "https://generativelanguage.googleapis.com/v1beta", "requires_key": True},
    "mistral": {"base_url": "https://api.mistral.ai/v1", "requires_key": True},
    "cohere": {"base_url": "https://api.cohere.ai/v1", "requires_key": True},
    "bedrock": {"base_url": None, "requires_key": True, "aws_required": True},
    
    # Free tier / OpenAI-compatible
    "groq": {"base_url": "https://api.groq.com/openai/v1", "requires_key": True},
    "together": {"base_url": "https://api.together.xyz/v1", "requires_key": True},
    "deepseek": {"base_url": "https://api.deepseek.com/v1", "requires_key": True},
    "perplexity": {"base_url": "https://api.perplexity.ai", "requires_key": True},
    "huggingface": {"base_url": "https://api-inference.huggingface.co/models", "requires_key": True},
    "nvidia": {"base_url": "https://integrate.api.nvidia.com/v1", "requires_key": True},
    "ollama": {"base_url": "http://localhost:11434/v1", "requires_key": False},
    "lmstudio": {"base_url": "http://localhost:1234/v1", "requires_key": False},
    "custom": {"base_url": "user_provided", "requires_key": True},
}

async def get_provider_config(provider: str) -> dict:
    return AI_PROVIDERS.get(provider, AI_PROVIDERS["custom"])
```

---

## 15. Plan Status: MISTY (Clarified, Not Built)

> No implementation started. All decisions documented.

### Confirmed
- ✅ Gmail + Outlook + Generic IMAP/SMTP
- ✅ 16+ AI providers (6 top tier + 10 free tier)
- ✅ PWA added to scope
- ✅ No local Android emulator (Expo Go + EAS only)
- ✅ Render hosting

### Pending User Decisions
1. **Which AI providers will you actually use?** (pick 2-3)
2. **Physical device for Expo Go testing?** (or Android SDK later)
3. **PWA vs APK priority?** (which ships first)
4. **Local dev: Docker / local Postgres / Render from day 1?**

### Next Actions (When Ready)
1. `git init` in threadmymail/
2. Create backend FastAPI skeleton
3. Add PostgreSQL + Alembic migrations
4. Implement auth + email account CRUD

---

*Architecture document updated with PWA, updated providers, and mobile strategy*
*Last updated: 2026-09-27*

---

## Cloudflare Storage (Optional)

### When to Use Cloudflare R2
- Attachments larger than 1 MB (PDFs, images, scans)
- Email body HTML with embedded images
- Backup archives of user data
- Any blob storage that doesn't fit in PostgreSQL

### Configuration via Wrangler
```bash
# Install wrangler
npm install -g wrangler

# Authenticate
wrangler login

# Create R2 bucket
wrangler r2 bucket create threadmymail-attachments

# Configure environment
export CLOUDFLARE_ACCOUNT_ID=your-account-id
export CLOUDFLARE_R2_ACCESS_KEY_ID=your-access-key
export CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-secret-key
export CLOUDFLARE_R2_BUCKET=threadmymail-attachments
```

### Python SDK Usage (boto3 compatible)
```python
import boto3
from botocore.config import Config

s3 = boto3.client(
    's3',
    endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
    aws_access_key_id=access_key,
    aws_secret_access_key=secret_key,
    config=Config(signature_version='s3v4'),
    region_name='auto'
)

# Upload attachment
s3.put_object(
    Bucket='threadmymail-attachments',
    Key=f'emails/{email_id}/{filename}',
    Body=file_bytes,
    ContentType=mime_type
)

# Generate presigned URL for download
url = s3.generate_presigned_url(
    'get_object',
    Params={'Bucket': 'threadmymail-attachments', 'Key': key},
    ExpiresIn=3600
)
```

### Integration with FastAPI
```python
# backend/storage/cloudflare.py
class CloudflareR2Storage:
    def __init__(self):
        self.client = boto3.client(...)
    
    async def upload_attachment(self, email_id: str, filename: str, content: bytes, mime: str) -> str:
        key = f"emails/{email_id}/{filename}"
        self.client.put_object(Bucket=BUCKET, Key=key, Body=content, ContentType=mime)
        return f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com/{BUCKET}/{key}"
    
    async def generate_download_url(self, key: str, expiry: int = 3600) -> str:
        return self.client.generate_presigned_url(...)
```

### Cost Estimate
| Item | Cost |
|------|------|
| R2 Storage | $0.015/GB/month |
| Class A operations (PUT/GET) | $4.50/million |
| Class B operations (LIST) | $0.36/million |
| Egress | Free (to Cloudflare CDN) |

For personal use with < 1 GB attachments: **~$0.02/month**.

---

*Last updated: 2026-09-27*
