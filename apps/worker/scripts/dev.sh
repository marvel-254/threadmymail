#!/usr/bin/env bash
# Local dev launcher: `npm run dev` (or `./scripts/dev.sh`).
#
# `wrangler dev` does not work out of the box in this repo. Two things must be
# arranged before wrangler starts, and both are easy to get wrong by hand:
#
#   1. CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB / _DB_FRESH must be in
#      the *shell* environment — wrangler validates them before it applies
#      .dev.vars, so values that live only in .dev.vars are invisible and
#      startup fails with "you should use a local Postgres connection string".
#   2. Node's Happy-Eyeballs family autoselection breaks every local Hyperdrive
#      connect on machines without IPv6 (100% ETIMEDOUT here; ipv4first alone
#      does not fix it). Wrangler's own proxy runs under plain `node`, so the
#      fix must reach it through NODE_OPTIONS.
#
# Gotchas behind both are recorded in IMPLEMENTATION_SUMMARY.md
# ("Environment gotchas") and apps/worker/.dev.vars.example.
set -euo pipefail

cd "$(dirname "$0")/.." # apps/worker, regardless of where we were invoked

DEV_VARS=.dev.vars

# ── 1. Export .dev.vars into the shell for wrangler/Hyperdrive ──────────────
if [[ ! -f $DEV_VARS ]]; then
  echo "dev.sh: $DEV_VARS not found." >&2
  echo "  Copy .dev.vars.example to .dev.vars and fill it in first." >&2
  exit 1
fi

# Drop comments/blank lines, then export each KEY="value". Parsing (rather
# than `source`) keeps a malformed line from executing arbitrary code, but
# quotes MUST be stripped here — `export "KEY=\"value\""` would keep the quote
# characters in the value and wrangler dies with "Invalid URL" on the Hyperdrive
# strings. Assumes the dotenv shape used by .dev.vars: one KEY=VALUE per line,
# no inline comments, no multiline values.
while IFS= read -r line || [[ -n $line ]]; do
  [[ -z $line || $line == \#* ]] && continue
  line=${line#export }          # tolerate an `export KEY=...` spelling
  key=${line%%=*}
  value=${line#*=}
  if [[ ${#key} -eq 0 || $key == "$line" ]]; then
    echo "dev.sh: skipping unparsable line in $DEV_VARS: $line" >&2
    continue
  fi
  case $value in
    \"*\"|\'*\') value=${value:1:${#value}-2} ;;  # strip one matching quote pair
  esac
  export "$key=$value"
done < "$DEV_VARS"

# ── 2. Stop Node's IPv6-first autoselection from breaking local Hyperdrive ──
# Append rather than clobber any NODE_OPTIONS the caller already set.
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--no-network-family-autoselection"

# ── 3. Hand off to wrangler, forwarding any extra args ─────────────────────
# Remote mode talks to the real Hyperdrive in the cloud — the local connection
# strings and listen address do not apply (--ip is local-only).
if [[ " $* " == *" --remote "* ]]; then
  exec npx wrangler dev "$@"
fi
# Extra args are appended after the script's own flags, so `npm run dev --
# --port 9000` overrides the defaults below.
exec npx wrangler dev --port "${TMM_PORT:-8787}" --ip 127.0.0.1 "$@"
