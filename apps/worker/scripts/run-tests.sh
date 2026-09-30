#!/usr/bin/env bash
# Run the TypeScript-backed test files.
#
# Node strips types but does not rewrite the `.js` specifiers the source uses for
# ESM, so a test that imports src/**/*.ts cannot be run directly. esbuild bundles
# the graph, resolving those specifiers for us.
#
#   bash apps/worker/scripts/run-tests.sh            # all TS-backed tests
#   bash apps/worker/scripts/run-tests.sh session identity
set -euo pipefail

cd "$(dirname "$0")/.."
ESBUILD=node_modules/@esbuild/linux-x64/bin/esbuild
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  names=(session identity)
fi

status=0
for name in "${names[@]}"; do
  src="test/${name}_test.mjs"
  if [ ! -f "$src" ]; then
    echo "no such test: $src" >&2
    status=1
    continue
  fi
  echo
  echo "── $name ──────────────────────────────────"
  "$ESBUILD" "$src" \
    --bundle --platform=node --format=esm --target=node20 \
    --outfile="$OUT/$name.mjs" --log-level=error
  if ! node "$OUT/$name.mjs"; then
    status=1
  fi
done

exit $status
