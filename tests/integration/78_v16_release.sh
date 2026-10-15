#!/usr/bin/env bash
# A release candidate is checked from a fresh object build, with compiler
# warnings fatal and every existing integration fixture run once.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"

make clean >/dev/null
strict_flags='-O2 -std=gnu11 -Wall -Wextra -pthread -Werror -Ivendor/tree-sitter/lib/include -Ivendor/tree-sitter/lib/src'
make -j2 CFLAGS="$strict_flags" cg
make -j2 CFLAGS="$strict_flags" unit

passed=0
scale_pid=''
scale_log=$(mktemp)
release_cleanup() {
    if [ -n "$scale_pid" ] && kill -0 "$scale_pid" 2>/dev/null; then
        kill "$scale_pid" 2>/dev/null || true
        wait "$scale_pid" 2>/dev/null || true
    fi
    rm -f "$scale_log"
}
trap release_cleanup EXIT
for test_file in tests/integration/[0-9]*.sh; do
    case "${test_file##*/}" in
        78_v16_release.sh|46_scale.sh) continue ;;
        17_session.sh)
            CG="$repo/cg" bash tests/integration/46_scale.sh >"$scale_log" 2>&1 &
            scale_pid=$!
            ;;
        77_index_resources.sh)
            if [ -n "$scale_pid" ]; then
                if ! wait "$scale_pid"; then
                    cat "$scale_log" >&2
                    echo 'release gate: 46_scale.sh failed' >&2
                    exit 1
                fi
                cat "$scale_log"
                scale_pid=''
                passed=$((passed + 1))
            fi
            ;;
    esac
    CG="$repo/cg" bash "$test_file"
    passed=$((passed + 1))
done

"$repo/cg" spec lint
[ "$("$repo/cg" --version)" = 1.6.0 ] || {
    echo 'release gate: binary version is not 1.6.0' >&2
    exit 1
}
[ "$(node -p "require('./editors/vscode/package.json').version")" = 1.6.0 ] || {
    echo 'release gate: extension package version is not 1.6.0' >&2
    exit 1
}
echo "release gate: strict clean build, units, $passed integration fixtures and spec lint passed"
