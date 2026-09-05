#!/usr/bin/env bash
set -u

repo=${1:-/Users/cct/code/iconic-cad}
cd "$repo" || exit 2

failures=0
for test_file in tests/*.mjs; do
  echo "RUN node $test_file"
  if ! node "$test_file"; then
    failures=$((failures + 1))
  fi
done

echo "RUN node scripts/export_members.mjs --verify"
if ! node scripts/export_members.mjs --verify; then
  failures=$((failures + 1))
fi

echo "TOTAL FAILING COMMANDS: $failures"
exit "$failures"
