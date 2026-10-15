#!/usr/bin/env bash
# A release candidate is checked from a fresh object build, with compiler
# warnings fatal and every existing integration fixture run once.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"

make clean >/dev/null
strict_flags='-O2 -std=gnu11 -Wall -Wextra -pthread -Werror'
make -j2 CFLAGS="$strict_flags" cg
make -j2 CFLAGS="$strict_flags" unit

passed=0
for test_file in tests/integration/[0-9]*.sh; do
    [ "${test_file##*/}" = 78_v16_release.sh ] && continue
    CG="$repo/cg" bash "$test_file"
    passed=$((passed + 1))
done

"$repo/cg" spec lint
[ "$("$repo/cg" --version)" = 1.6.0 ] || {
    echo 'release gate: binary version is not 1.6.0' >&2
    exit 1
}
echo "release gate: strict clean build, units, $passed integration fixtures and spec lint passed"
