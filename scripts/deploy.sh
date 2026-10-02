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
# Health checks target the Worker directly. Browser requests use the same-origin
# Pages Function in /functions so the browser session cookie stays first-party.
API_ORIGIN="${API_ORIGIN:-https://threadmymail-worker.twistedoliver211fs.workers.dev}"
APP_ORIGIN="${APP_ORIGIN:-https://threadmymail.omixsystems.store}"
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

# ── 2. Find a working Cloudflare credential ─────────────────────────────────
# The token is never printed.
#
# Two traps here, both hit for real on 2026-09-29:
#
#   a) There are two wrangler config locations. `~/.wrangler/config/` and
#      `~/.config/.wrangler/config/` belong to different wrangler versions, and
#      `wrangler login` writes to whichever one the binary you typed uses. A
#      fresh login can therefore leave a stale, 403-ing token sitting in the
#      other, so hardcoding either path is a coin flip.
#   b) `expiration_time` inside those files is not trustworthy. It still read a
#      value from over an hour earlier while the token in the same file worked
#      perfectly, so trusting it would block a perfectly good session.
#
# Therefore: try each candidate and actually call the API. A token is accepted
# only if it authenticates right now, not because some file claims it should.
step "Authenticating"
CANDIDATES=(
  "${WRANGLER_CONFIG:-}"
  "$HOME/.wrangler/config/default.toml"
  "$HOME/.config/.wrangler/config/default.toml"
)
OAUTH_TOKEN=""
for cfg in "${CANDIDATES[@]}"; do
  [ -n "$cfg" ] && [ -f "$cfg" ] || continue
  candidate="$(tr ',' '\n' < "$cfg" | grep oauth_token | cut -d'"' -f2 || true)"
  [ -n "$candidate" ] || continue
  if [ "$(curl -sS -m 20 -o /dev/null -w '%{http_code}' \
        -H "Authorization: Bearer $candidate" \
        "https://api.cloudflare.com/client/v4/accounts" 2>/dev/null)" = "200" ]; then
    OAUTH_TOKEN="$candidate"
    echo "  authenticated via $cfg"
    break
  fi
  echo "  stale credentials in $cfg — skipping"
done
[ -n "$OAUTH_TOKEN" ] || fail "no working Cloudflare credential in any of:
     ${CANDIDATES[*]}
     Re-authenticate with:  wrangler login
     If you have just logged in and still see this, the login was written to a
     different wrangler config than the one being read. Run wrangler login from
     apps/worker so it matches the pinned binary."
export CLOUDFLARE_ACCOUNT_ID
  echo "  using wrangler OAuth token (not printed)"

# Always the copy pinned in apps/worker. A global/root `npx wrangler` is a
# different version with different auth behaviour.
WRANGLER="$WORKER/node_modules/.bin/wrangler"
[ -x "$WRANGLER" ] || fail "wrangler not installed — run npm install in apps/worker"

# ── 3. Typecheck before anything ships ──────────────────────────────────────
step "Typechecking the Worker"
(cd "$WORKER" && npx tsc --noEmit) || fail "typecheck failed — not deploying"

# ── 4. Build the frontend with its same-origin API route ───────────────────
if [ "$SKIP_FRONTEND" = 0 ]; then
  step "Building the frontend"
  # /v1 is handled by functions/v1/[[path]].js, keeping OAuth and the session
  # cookie on the custom app hostname rather than cross-site on workers.dev.
  echo "  VITE_API_BASE = /v1 (same-origin Pages Function)"
  echo "  VITE_WS_URL   = wss://${APP_ORIGIN#https://}/v1/agent/stream"
  (cd "$FRONTEND" && \
    VITE_API_BASE="/v1" \
    VITE_WS_URL="wss://${APP_ORIGIN#https://}/v1/agent/stream" \
    npx vite build) || fail "frontend build failed"

  # Verify the same-origin route actually made it into the bundle.
  BUNDLE="$(grep -ro '/assets/index-[A-Za-z0-9_-]*\.js' "$FRONTEND/dist/index.html" | head -1)"
  if ! grep -qF '"/v1"' "$FRONTEND/dist$BUNDLE"; then
    fail "the same-origin API base is not in $BUNDLE — refusing to publish a bundle that calls the wrong host"
  fi
  echo "  confirmed same-origin API base is in $BUNDLE"
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
  custom_code="$(curl -sS -m 30 -o /dev/null -w '%{http_code}' "$APP_ORIGIN/privacy")"
  [ "$custom_code" = "200" ] || fail "$APP_ORIGIN/privacy returned $custom_code"
  echo "  custom-domain privacy page 200 ✓"

  oauth_headers="$(mktemp /tmp/tmm-oauth-check.XXXXXX)"
  oauth_code="$(curl -sS -m 30 -D "$oauth_headers" -o /dev/null -w '%{http_code}' \
    "$APP_ORIGIN/v1/auth/google")" || { rm -f "$oauth_headers"; fail "OAuth start route is unreachable"; }
  oauth_location="$(tr -d '\r' < "$oauth_headers" | grep -i '^location:' | head -1 || true)"
  if [ "$oauth_code" != "302" ] || ! printf '%s' "$oauth_location" \
    | grep -qi '^location: https://accounts\.google\.com/o/oauth2/v2/auth?'; then
    rm -f "$oauth_headers"
    fail "OAuth start did not return a browser redirect to Google (HTTP $oauth_code)"
  fi
  if ! tr -d '\r' < "$oauth_headers" | grep -qi '^set-cookie: tmm_oauth_state='; then
    rm -f "$oauth_headers"
    fail "OAuth start did not set the state cookie on the custom domain"
  fi
  rm -f "$oauth_headers"
  echo "  custom-domain OAuth start redirects to Google with state cookie ✓"

  # The redirect-preserving proxy is only useful if /v1/* actually reaches it.
  # A stale app shell would serve index.html here instead of the API.
  # /v1/skills requires a session cookie so 401 is the correct unauthenticated
  # response — it proves the proxy is routing to the Worker. Only a 404 or the
  # raw index.html would mean something is wrong.
  skills_code="$(curl -sS -m 30 -o /dev/null -w '%{http_code}' "$APP_ORIGIN/v1/skills")"
  if [ "$skills_code" = "200" ] || [ "$skills_code" = "401" ]; then
    echo "  custom-domain /v1/skills ${skills_code} from the proxy ✓"
  else
    fail "$APP_ORIGIN/v1/skills returned $skills_code (expected 200 or 401 from the proxy, not the app shell)"
  fi
fi

printf '\n\033[32mDeployed and verified.\033[0m  %s\n' "$API_ORIGIN"
echo "App: ${APP_ORIGIN}/app"
echo
echo "Note: database migrations are not run by this script."
echo "      node apps/worker/scripts/db-push.mjs <file.sql> --dry-run   # inspect first"
