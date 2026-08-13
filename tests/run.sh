#!/usr/bin/env bash
# Codify integration test runner. Usage: CG=/path/to/cg tests/run.sh
set -u
cd "$(dirname "$0")"
: "${CG:=$(cd .. && pwd)/cg}"
export CG

if [ ! -x "$CG" ]; then
    echo "tests/run.sh: CG binary not found at $CG (run make first)" >&2
    exit 1
fi

pass=0 fail=0
log="$(mktemp)"
for t in integration/[0-9]*.sh; do
    name="$(basename "$t")"
    if bash "$t" >"$log" 2>&1; then
        echo "PASS $name"
        pass=$((pass + 1))
    else
        echo "FAIL $name"
        sed 's/^/     /' "$log"
        fail=$((fail + 1))
    fi
done
rm -f "$log"
echo "integration: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
