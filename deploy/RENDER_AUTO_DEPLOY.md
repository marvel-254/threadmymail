# Render Auto-Deploy Setup

## Current Status
- Render CLI: Authenticated (Langat / twistedoliver211fs@gmail.com)
- Render Project: `nemo` (prj-d8t3m3nlk1mc73ako5pg)
- Render DB: `htmg-db` (free tier, PostgreSQL 16, available)
- GitHub: `marvel-254/threadmymail` (main branch)
- Wrangler: Installed (v4.131.1), needs `wrangler login` for R2

## Next Steps

### 1. Set GitHub Secrets (run locally or via gh CLI)
```bash
gh secret set OPENROUTER_API_KEY --repo marvel-254/threadmymail --body "sk-or-v1-..."
gh secret set DATABASE_URL --repo marvel-254/threadmymail --body "postgresql://htmg:...@dpg-.../htmg"
gh secret set SLACK_WEBHOOK_URL --repo marvel-254/threadmymail --body "https://hooks.slack.com/services/..."
```

### 2. Create Render Web Service (for FastAPI backend)
```bash
# After setting DATABASE_URL locally
render deploys create --service web-service --branch main --repo https://github.com/marvel-254/threadmymail
```

Or manually in Render dashboard:
- Connect `marvel-254/threadmymail`
- Select `main` branch
- Environment: `Python`
- Build Command: `pip install -r backend/requirements.txt`
- Start Command: `gunicorn backend.app:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT`
- Add env vars: `DATABASE_URL`, `OPENROUTER_API_KEY`

### 3. Auto-Deploy (Render + GitHub)
- In Render dashboard: Service → Settings → Deploys → Enable "Auto-Deploy from GitHub"
- Branch: `main`
- Build Filter: None (deploy on every push)
- Preview Environment: Optional (disable for simplicity)

### 4. Wrangler / Cloudflare R2
```bash
wrangler login  # Authenticate with Cloudflare
wrangler r2 bucket create threadmymail-attachments
```

Then add `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET` to Render env vars (optional, or manage locally).

### 5. CI/CD Workflow (`.github/workflows/ci-cd.yml`)
Already created. Once secrets are set:
- `test-backend` runs on every PR/push
- `build-frontend` builds PWA
- `notify` sends Slack notification on `main`
- Render auto-deploy triggers independently from code push
