# ThreadMyMail - Render Deployment Guide

> # ⚠️ DEPRECATED — DO NOT FOLLOW
>
> **Render is no longer the deployment target.** Superseded on 2026-09-27.
>
> **Use [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) instead.** The Worker
> deploys to Cloudflare; the database is Neon; blobs are in R2; the frontend is
> on Cloudflare Pages.

---

## Why Render was abandoned

| Problem | Consequence |
|---|---|
| Free web services **spin down after ~15 min idle** | The in-process APScheduler dies with it. The agent cannot act on a schedule — which is the core of the product. |
| **Free Postgres expires 30 days after creation** (14-day grace, then deleted) | `htmg-db` expires **2026-10-09**. All data lost after the grace period. |
| No durable execution primitives | Nothing equivalent to Durable Objects or Workflows. |
| Always-on requires the $7/mo Starter plan | A permanent cost for an idle-tolerant app. |

## What replaced it

| Was | Now |
|---|---|
| Render web service (FastAPI) | **Cloudflare Workers** + **Durable Objects** |
| APScheduler in-process | **Cron Triggers** + **Workflows** |
| Render Postgres `htmg-db` | **Neon** (Postgres + pgvector), pooled by **Hyperdrive** |
| Local disk for attachments | **Cloudflare R2** (10 GB free, egress free) |
| Render static site | **Cloudflare Pages** |
| APScheduler tasks | **Skills** with `cron` / `event` / `on_demand` triggers |

See [../docs/PLAN.md](../docs/PLAN.md) §9 for the full decision log.

---

*Retained for historical reference only. Nothing below reflects the current system.*

---

## 1. Prerequisites

- A Render.com account
- GitHub repository with:
  - `threadmymail/` directory structure
  - `render.yaml`
  - `requirements.txt` / `pyproject.toml`
  - Dockerfile (optional)

- Environment variables configured in Render dashboard:
  - `DATABASE_URL` (from Render PostgreSQL)
  - `SECRET_KEY` (for JWT signing)
  - `ENCRYPTION_KEY` (for email credentials)
  - `EXPO_PROJECT_ID` (optional, for push notifications)
  - `EXPO_ACCESS_TOKEN` (optional, for push notifications)
  - `FRONTEND_URL` (optional, for CORS)

---

## 2. Directory Structure

```
threadmymail/
├── backend/
│   ├── app.py              # FastAPI app entry point
│   ├── config.py           # Settings
│   ├── database.py         # DB connection & models
│   ├── auth.py             # JWT + magic link auth
│   ├── accounts.py         # Email account management
│   ├── emails.py           # Email sync & storage
│   ├── ai_service.py       # AI integration (LiteLLM)
│   ├── notifications.py    # Push + email notifications
│   ├── tasks.py            # Scheduling
│   ├── websocket.py        # Real-time updates
│   ├── workers.py          # Background tasks
│   └── dependencies.py     # Shared dependencies
├── frontend/
│   ├── index.html         # SPA entry
│   └── assets/            # Static assets (optional)
├── docs/                   # This documentation
├── requirements.txt       # Python dependencies
├── pyproject.toml        # Modern Python project config
├── render.yaml           # Render service config
└── docker-compose.yml    # Local development (optional)
```

---

## 3. Python Project Setup

### requirements.txt
```txt
fastapi>=0.104.1
uvicorn[standard]>=0.24.1
litellm>=1.40.0
psycopg2-binary>=2.9
pydantic>=2.5
python-jose[cryptography]>=3.3
passlib[bcrypt]>=1.4
cryptography>=41.0
APScheduler>=3.10
python-multipart>=0.0.4
python-dateutil>=2.8
redis>=5.0
gunicorn>=21.0
email-validator>=2.0
async-timeout>=4.0.3
aiolimiter>=1.0
minio>=7.2.0  # optional: for attachment storage
```

### pyproject.toml
```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "threadmymail"
version = "0.1.0"
description = "AI-powered email management platform"
authors = [
    {name = "Your Name", email = "your@email.com"}
]
license = {text = "MIT"}
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.104.1",
    "uvicorn[standard]>=0.24.1",
    "litellm>=1.40.0",
    "psycopg2-binary>=2.9",
    "pydantic>=2.5",
    "python-jose[cryptography]>=3.3",
    "passlib[bcrypt]>=1.4",
    "cryptography>=41.0",
    "APScheduler>=3.10",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4",
    "pytest-asyncio>=0.21",
    "ruff>=0.1",
    "black>=23.7",
    "mypy>=1.5"
]

[tool.hatch.build]
include = ["threadmymail/", "README.md", "render.yaml"]

[tool.ruff]
select = ["E", "F", "I", "B"]
ignore = []
line-length = 88

[tool.black]
line-length = 88
target-version = ['py311']
```

---

## 4. Core Application (backend/app.py)

### Quick Setup
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from contextlib import asynccontextmanager

from threadmymail.database import init_db
from threadmymail.auth import router as auth_router
from threadmymail.accounts import router as accounts_router
from threadmymail.emails import router as emails_router
from threadmymail.ai_service import router as ai_router
from threadmymail.tasks import router as tasks_router
from threadmymail.notifications import router as notifications_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    print("ThreadMyMail API starting up...")
    
    # Start background workers
    from threadmymail.workers import start_workers
    await start_workers()
    
    yield
    
    # Shutdown
    print("ThreadMyMail API shutting down...")

app = FastAPI(
    title="ThreadMyMail API",
    description="AI-powered email management platform",
    version="0.1.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(emails_router)
app.include_router(ai_router)
app.include_router(tasks_router)
app.include_router(notifications_router)

if __name__ == "__main__":
    uvicorn.run("backend.app:app", host="0.0.0.0", port=8000, reload=True)
```

---

## 5. render.yaml

```yaml
services:
  - type: web
    name: threadmymail-api
    env: python
    plan: free
    buildCommand: |
      pip install -r requirements.txt
      # Build if needed
    startCommand: gunicorn --bind 0.0.0.0:$PORT backend.app:app --workers 2
    healthCheckPath: /health
    envVars:
      # Required
      - key: DATABASE_URL
        fromDatabase: threadmymail-db
      - key: SECRET_KEY
        generateValue: true
      - key: ENCRYPTION_KEY
        generateValue: true
      
      # Optional
      - key: FRONTEND_URL
        value: "https://threadmymail.onrender.com"
      - key: EXPO_PROJECT_ID
        value: "your-expo-project-id"
      - key: EXPO_ACCESS_TOKEN
        value: "your-expo-access-token"
      
      # AI Provider (if needed)
      - key: OPENAI_API_KEY
        value: "sk-your-openai-key"
    
  - type: pserv
    name: threadmymail-db
    env: postgres
    plan: free
    databases:
      - name: threadmymail-db
        plan: free
        
  # Optional: Redis for rate limiting + Celery
  - type: worker
    name: threadmymail-workers
    env: python
    plan: free
    buildCommand: pip install -r requirements.txt
    startCommand: python -m threadmymail.workers
    envVars:
      - key: DATABASE_URL
        fromDatabase: threadmymail-db
      - key: REDIS_URL
        fromService:
          type: redis
          name: threadmymail-redis
    
  - type: redis
    name: threadmymail-redis
    plan: free
```

---

## 6. Database Configuration

### database.py
```python
import asyncpg
from contextlib import asynccontextmanager
from typing import AsyncGenerator
import os

DB_POOL = None

async def get_db_pool():
    global DB_POOL
    if DB_POOL is None:
        DB_POOL = await asyncpg.create_pool(
            os.getenv("DATABASE_URL"),
            min_size=1,
            max_size=20,
            timeout=30
        )
    return DB_POOL

@asynccontextmanager
async def get_connection() -> AsyncGenerator[asyncpg.Connection, None]:
    pool = await get_db_pool()
    async with pool.acquire() as connection:
        async with connection.transaction():
            yield connection

async def init_db():
    """Initialize database with required extensions"""
    async with get_connection() as conn:
        # Enable required extensions
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector");  # for pgvector
        await conn.execute("CREATE EXTENSION IF NOT EXISTS "uuid-ossp"");
        
        # Create tables if they don't exist
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                email VARCHAR(255) UNIQUE NOT NULL,
                full_name VARCHAR(255),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                ai_config JSONB DEFAULT '{}',
                notification_settings JSONB DEFAULT '{}',
                theme VARCHAR(20) DEFAULT 'system',
                timezone VARCHAR(50) DEFAULT 'UTC'
            );
        """)
        # ... create other tables (omitted for brevity)
```

---

## 7. Environment Variables

### Required
```bash
# Database (automatically provided by Render PostgreSQL service)
DATABASE_URL=postgresql://username:password@threadmymail-db.internal:5432/threadmymail

# Security (generated automatically)
SECRET_KEY=your-secret-key-here
ENCRYPTION_KEY=your-32-character-encryption-key
```

### Optional
```bash
# Frontend URL (for CORS)
FRONTEND_URL=https://threadmymail.onrender.com

# Push Notifications (Expo)
EXPO_PROJECT_ID=your-expo-project-id
EXPO_ACCESS_TOKEN=your-expo-access-token

# AI Providers (BYOK)
OPENAI_API_KEY=sk-your-key-here
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

---

## 8. Local Development

### docker-compose.yml (Optional)
```yaml
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app/backend
    env_file:
      - .env
    depends_on:
      - db
      - redis
    
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - VITE_API_URL=http://localhost:8000
    
  db:
    image: postgres:15
    environment:
      - POSTGRES_DB=threadmymail
      - POSTGRES_USER=threadmymail
      - POSTGRES_PASSWORD=threadmymail
    volumes:
      - postgres_data:/var/lib/postgresql/data
    
  redis:
    image: redis:7-alpine
    
  workers:
    build: .
    command: python -m threadmymail.workers
    env_file:
      - .env
    depends_on:
      - db
      - redis
    volumes:
      - ./backend:/app/backend

volumes:
  postgres_data:
```

### .env (local)
```bash
DATABASE_URL=postgresql://threadmymail:threadmymail@localhost:5432/threadmymail
SECRET_KEY=your-secret-key-local-only
ENCRYPTION_KEY=32-character-encryption-key-local
FRONTEND_URL=http://localhost:3000
```

---

## 9. Deployment Steps

1. **Commit and Push**
```bash
git add .
git commit -m "Initial commit: ThreadMyMail API"
git push origin main
```

2. **Create Render Services**
   - Go to [render.com](https://render.com)
   - Click "New Web Service"
   - Connect GitHub repo
   - Select "Python" runtime
   - Upload `render.yaml` or configure manually
   - Add environment variables
   - Deploy

3. **Monitor Deployment**
   - Check web service logs
   - Verify health endpoint: `/health`
   - Check database connection

4. **Initial Setup**
   - Visit `https://your-app.onrender.com`
   - Initialize admin user (first email)
   - Configure email accounts

---

## 10. Monitoring & Maintenance

### Health Check
```bash
# Check API health
curl https://your-app.onrender.com/health

# Database status
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity;"
```

### Logs
- Access Render dashboard → Logs → Web Service
- Look for errors in startup sequence
- Monitor sync worker logs

### Backups
```bash
# Manual backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Configure automated backups in Render dashboard
# Go to Services → Your DB → Backups
```

---

## 11. Cost Optimization

### Free Tier Limits
- **Web Service**: 750 free hours/month
- **PostgreSQL**: 90 days free, then $7/mo starter
- **Redis**: Free (500MB memory)

### Tips
1. Use Vercel Functions for static assets (if using Next.js)
2. Implement database connection pooling (already configured)
3. Use lazy loading for AI model downloads
4. Set up automated scaling (Render Pro plans)

---

## 12. Troubleshooting

### Common Issues

**1. Database Connection Failed**
```yaml
# Check DATABASE_URL in Render dashboard
# Verify PostgreSQL service is running
# Ensure firewall allows connections
```

**2. CORS Errors**
```yaml
# Add frontend URL to allow_origins in FastAPI app
# Update FRONTEND_URL environment variable
```

**3. AI Provider Key Missing**
```yaml
# Add provider API keys to environment variables
# Update ai_config in user settings
```

**4. Sync Hanging**
```python
# Check IMAP credentials
# Verify network connectivity to email providers
# Check for large mailbox folders
```

---

## 13. Production Checklist

- [ ] Database migrations tested
- [ ] Email account connections verified
- [ ] AI provider API keys configured
- [ ] CORS settings correct
- [ ] Rate limiting implemented
- [ ] SSL certificates valid
- [ ] Backup schedule configured
- [ ] Monitoring alerts set up
- [ ] Performance benchmarks met
- [ ] Load testing completed (optional)

---

## 14. Future Scaling

### Horizontal Scaling
- Multiple web service instances
- Database read replicas
- CDN for static assets

### Vertical Scaling
- Increase PostgreSQL plan
- Add Redis for caching
- Upgrade worker instances

---

*Render deployment guide for ThreadMyMail API*
*Last updated: 2026-09-27*