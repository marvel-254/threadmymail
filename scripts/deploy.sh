#!/usr/bin/env bash
#
# Deploy ThreadMyMail: Worker API, then the Pages frontend, then verify.
#
# This exists because the frontend deploy was previously manual improvisation,
# and two of its steps fail in ways that are easy to miss:
#
#   1. Vite inlines VITE_* at BUILD time. Forget them and you publish a bundle
#      that calls `/v1` on pages.dev, where no Worker exists. The site loads
#      and every request 404s — which looks like a backend outage, not a build
#      mistake. They are set below and asserted before the build runs.
#   2. `wrangler pages deploy` refuses to authenticate in a non-interactive
#      shell. It will not use its own OAuth token and demands
#      CLOUDFLARE_API_TOKEN — but that token carries pages:write and works
#      fine when passed through the variable, so we pass it through.
#
# Order matters: Worker first, then frontend. The reverse would briefly publish
# a frontend whose API contract is not deployed yet.
#
# Usage:
#   bash scripts/deploy.sh                 # deploy the committed tree
#   bash scripts/deploy.sh --allow-dirty   # deploy with uncommitted changes
#   bash scripts/deploy.sh --skip-frontend # API only
#
# Database migrations are deliberately NOT run here. They change data, they are
# not reversible by re-running this script, and they need a human to look at
# the SQL first:  node apps/worker/scripts/db-push.mjs <file> --dry-run
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER="$ROOT/apps/worker"
FRONTEND="$ROOT/frontend"

# ── Source of truth for the deployed addresses ──────────────────────────────
# The frontend bundle must point at these. Kept here (not inline in the build
# command) so there is exactly one place to change when the Worker moves.
API_ORIGIN="${API_ORIGIN:-https://threadmymail-worker.twistedoliver211fs.workers.dev}"
PAGES_PROJECT="threadmymail"
CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-9e7ca541fc83eab0e3608e50d7a0be47}"

ALLOW_DIRTY=0
SKIP_FRONTEND=0
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\033[31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

# ── 1. Refuse to ship a dirty tree ──────────────────────────────────────────
step "Checking the tree"
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  if [ "$ALLOW_DIRTY" = 0 ]; then
    git -C "$ROOT" status --short
    fail "working tree is dirty. Commit first, or pass --allow-dirty on purpose."
  fi
  echo "  ! deploying with uncommitted changes (--allow-dirty)"
fi
echo "  HEAD $(git -C "$ROOT" rev-parse --short HEAD)"

# ── 2. Read wrangler's OAuth token for the Pages deploy ─────────────────────
# Read straight from wrangler's own config. Never echoed.
#
# IMPORTANT: this is deliberately NOT exported. `wrangler pages deploy` will not
# use its own OAuth token non-interactively and demands CLOUDFLARE_API_TOKEN,
# so it is passed inline to that one command below. Exporting it globally breaks
# the Worker deploy, which takes a different path and rejects the OAuth token
# with "Invalid access token [9109]". Same bytes, two different presentations.
step "Authenticating"
WRANGLER_CONFIG="${WRANGLER_CONFIG:-$HOME/.config/.wrangler/config/default.toml}"
if [ ! -f "$WRANGLER_CONFIG" ]; then
  fail "no wrangler credentials at $WRANGLER_CONFIG — run 'wrangler login' in an interactive terminal"
fi
OAUTH_TOKEN="$(tr ',' '\n' < "$WRANGLER_CONFIG" | grep oauth_token | cut -d'"' -f2)"
[ -n "$OAUTH_TOKEN" ] || fail "could not read oauth_token from $WRANGLER_CONFIG"

# Wrangler refreshes its OAuth token transparently in an interactive shell but
# cannot here, and when it is stale it fails with two unrelated-looking errors:
# "Invalid access token [9109]" on one path, and "it's necessary to set a
# CLOUDFLARE_API_TOKEN environment variable" on the other. Neither mentions
# expiry and retrying does not help, so check the clock up front and name the
# actual problem.
EXPIRY="$(tr ',' '\n' < "$WRANGLER_CONFIG" | grep expiration_time | cut -d'"' -f2 || true)"
if [ -n "$EXPIRY" ] && date -d "$EXPIRY" +%s >/dev/null 2>&1; then
  EXPIRY_EPOCH="$(date -d "$EXPIRY" +%s)"
  NOW_EPOCH="$(date +%s)"
  if [ "$NOW_EPOCH" -ge "$EXPIRY_EPOCH" ]; then
    fail "the wrangler login expired at $EXPIRY (now $(date -u +%Y-%m-%dT%H:%M:%SZ)).
     This is a session expiry, not a code problem. Re-authenticate with:
         wrangler login
     That needs a browser, so it cannot be done from a script."
  fi
  echo "  session valid for $(( (EXPIRY_EPOCH - NOW_EPOCH) / 60 )) more minutes"
elif [ -n "$EXPIRY" ]; then
  echo "  ! could not parse expiration_time '$EXPIRY' — continuing"
fi

export CLOUDFLARE_ACCOUNT_ID
  echo "  using wrangler OAuth token (not printed)"

# Always the copy pinned in apps/worker. A global/root `npx wrangler` is a
# different version with different auth behaviour.
WRANGLER="$WORKER/node_modules/.bin/wrangler"
[ -x "$WRANGLER" ] || fail "wrangler not installed — run npm install in apps/worker"

# ── 3. Typecheck before anything ships ──────────────────────────────────────
step "Typechecking the Worker"
(cd "$WORKER" && npx tsc --noEmit) || fail "typecheck failed — not deploying"

# ── 4. Build the frontend with the real API baked in ────────────────────────
if [ "$SKIP_FRONTEND" = 0 ]; then
  step "Building the frontend"
  # Assert the variables are non-empty. A typo here is silent otherwise: the
  # bundle falls back to '/v1' and the published site 404s on every call.
  [ -n "$API_ORIGIN" ] || fail "API_ORIGIN is empty"
  echo "  VITE_API_BASE = $API_ORIGIN/v1"
  echo "  VITE_WS_URL   = ${API_ORIGIN/http:/https:}"
  (cd "$FRONTEND" && \
    VITE_API_BASE="$API_ORIGIN/v1" \
    VITE_WS_URL="wss://${API_ORIGIN#https://}/v1/agent/stream" \
    npx vite build) || fail "frontend build failed"

  # Verify the URL actually made it into the bundle before publishing.
  BUNDLE="$(grep -ro '/assets/index-[A-Za-z0-9_-]*\.js' "$FRONTEND/dist/index.html" | head -1)"
  if ! grep -qF "$API_ORIGIN/v1" "$FRONTEND/dist$BUNDLE"; then
    fail "the API origin is not in $BUNDLE — refusing to publish a bundle that calls the wrong host"
  fi
  echo "  confirmed $API_ORIGIN is in $BUNDLE"
fi

# ── 5. Deploy the Worker ───────────────────────────────────────────────────
# wrangler deploy intermittently fails with a bare "fetch failed" on this
# network. It is transient, so retry rather than fail the whole deploy.
step "Deploying the Worker"
deployed=0
for attempt in 1 2 3 4 5; do
  if (cd "$WORKER" && "$WRANGLER" deploy --name threadmymail-worker) > /tmp/tmm-deploy.log 2>&1; then
    grep -oE 'Current Version ID: [0-9a-f-]+' /tmp/tmm-deploy.log || true
    deployed=1
    break
  fi
  if ! grep -qiE 'fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up' /tmp/tmm-deploy.log; then
    echo "  not a transient network error — failing immediately"
    tail -20 /tmp/tmm-deploy.log
    fail "Worker deploy failed"
  fi
  echo "  attempt $attempt hit a transient network error, retrying…"
  sleep 12
done
[ "$deployed" = 1 ] || { tail -20 /tmp/tmm-deploy.log; fail "Worker deploy failed after 5 attempts"; }

# ── 6. Deploy the frontend ─────────────────────────────────────────────────
if [ "$SKIP_FRONTEND" = 0 ]; then
  step "Deploying the frontend"
  (cd "$ROOT" && CLOUDFLARE_API_TOKEN="$OAUTH_TOKEN" "$WRANGLER" pages deploy "$FRONTEND/dist" \
    --project-name "$PAGES_PROJECT" --branch main) > /tmp/tmm-pages.log 2>&1 \
    || { tail -20 /tmp/tmm-pages.log; fail "frontend deploy failed"; }
  grep -oE 'https://[a-z0-9]+\.threadmymail\.pages\.dev' /tmp/tmm-pages.log | tail -1 || true
fi

# ── 7. Verify what is actually live ─────────────────────────────────────────
# A deploy that reports success but serves the wrong thing is the failure mode
# that matters, so check behaviour rather than trusting the CLI.
step "Verifying production"
sleep 5
health="$(curl -sS -m 30 "$API_ORIGIN/health")" || fail "/health unreachable"
echo "  $health"
case "$health" in
  *'"environment":"production"'*) echo "  environment: production ✓" ;;
  *) fail "production is not reporting itself as production: $health" ;;
esac
case "$health" in
  *'"credentials_encrypted":true'*) echo "  credentials encrypted ✓" ;;
  *) fail "ENCRYPTION_KEY is missing in production — credential writes will 503" ;;
esac

if [ "$SKIP_FRONTEND" = 0 ]; then
  origin="https://${PAGES_PROJECT}.pages.dev"
  acao="$(curl -sS -m 30 -D - -o /dev/null -H "Origin: $origin" "$API_ORIGIN/v1/skills" \
    | tr -d '\r' | grep -i '^access-control-allow-origin:' | awk '{print $2}')"
  if [ "$acao" = "$origin" ]; then
    echo "  CORS allows $origin ✓"
  else
    fail "CORS does not allow $origin (got '${acao:-<none>}') — the published frontend cannot call the API"
  fi
  code="$(curl -sS -m 30 -o /dev/null -w '%{http_code}' "$origin/app")"
  [ "$code" = "200" ] || fail "$origin/app returned $code"
  echo "  frontend /app 200 ✓"
fi

printf '\n\033[32mDeployed and verified.\033[0m  %s\n' "$API_ORIGIN"
echo "App: https://${PAGES_PROJECT}.pages.dev/app"
echo
echo "Note: database migrations are not run by this script."
echo "      node apps/worker/scripts/db-push.mjs <file.sql> --dry-run   # inspect first"
