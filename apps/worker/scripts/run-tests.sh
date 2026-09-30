#!/usr/bin/env bash
# Run the TypeScript-backed test files.
#
# Node strips types but does not rewrite the `.js` specifiers the source uses for
# ESM, so a test that imports src/**/*.ts cannot be run directly. esbuild bundles
# the graph, resolving those specifiers for us.
#
#   bash apps/worker/scripts/run-tests.sh            # every *_test.mjs
#   bash apps/worker/scripts/run-tests.sh session identity
set -euo pipefail

cd "$(dirname "$0")/.."
ESBUILD=node_modules/@esbuild/linux-x64/bin/esbuild
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

# Discover, do not curate. An earlier version of this script defaulted to a
# hardcoded pair of suite names, which meant it reported "34 passed" while
# quietly skipping the other 115 tests in this directory. A test runner that
# under-reports is worse than no runner, because it reads as a green light.
if [ $# -eq 0 ]; then
  mapfile -t names < <(cd test && ls *_test.mjs 2>/dev/null | sed 's/_test\.mjs$//' | sort)
  if [ ${#names[@]} -eq 0 ]; then
    echo "no test files in test/*_test.mjs" >&2
    exit 1
  fi
else
  names=("$@")
fi

total_pass=0
total_fail=0
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
  if ! out=$(node "$OUT/$name.mjs"); then
    status=1
  fi
  p=$(grep -oE '[0-9]+ passed' <<<"$out" | tail -1 | grep -oE '^[0-9]+' || true)
  f=$(grep -oE '[0-9]+ failed' <<<"$out" | tail -1 | grep -oE '^[0-9]+' || true)
  total_pass=$(( total_pass + ${p:-0} ))
  total_fail=$(( total_fail + ${f:-0} ))
done

echo
echo "── total ─────────────────────────────────"
echo "${#names[@]} suites, ${total_pass} passed, ${total_fail} failed"
exit $status
