#!/usr/bin/env bash
# A release candidate is checked from a fresh object build, with compiler
# warnings fatal and every existing integration fixture run once.
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
cd "$repo"

mkdir -p build
scratch=$(mktemp -d build/release-check.XXXXXX)
trap 'rm -rf "$scratch"' EXIT
release_cg="$repo/$scratch/cg"
build_args=(BUILD="$scratch/build" BIN="$repo/$scratch/hyperfide" COMPAT_BIN="$release_cg")
strict_flags='-O2 -std=gnu11 -Wall -Wextra -pthread -Werror -Ivendor/tree-sitter/lib/include -Ivendor/tree-sitter/lib/src'
make -j2 "${build_args[@]}" CFLAGS="$strict_flags" "$release_cg"
make -j2 "${build_args[@]}" CFLAGS="$strict_flags" unit

passed=0
scale_pid=''
scale_log=$(mktemp)
release_cleanup() {
    if [ -n "$scale_pid" ] && kill -0 "$scale_pid" 2>/dev/null; then
        kill "$scale_pid" 2>/dev/null || true
        wait "$scale_pid" 2>/dev/null || true
    fi
    rm -f "$scale_log"
    rm -rf "$scratch"
}
trap release_cleanup EXIT
for test_file in tests/integration/[0-9]*.sh; do
    case "${test_file##*/}" in
        78_v16_release.sh|46_scale.sh) continue ;;
        17_session.sh)
            CG="$release_cg" bash tests/integration/46_scale.sh >"$scale_log" 2>&1 &
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
    CG="$release_cg" bash "$test_file"
    passed=$((passed + 1))
done

"$release_cg" spec lint
expected_version=$(printf '#include "src/cg.h"\nCG_VERSION\n' | "${CC:-cc}" -E -P -x c - | tail -n 1 | tr -d '"')
[ "$("$release_cg" --version)" = "$expected_version" ] || {
    echo "release gate: binary version is not $expected_version" >&2
    exit 1
}
[ "$(node -p "require('./editors/vscode/package.json').version")" = "$expected_version" ] || {
    echo "release gate: extension package version is not $expected_version" >&2
    exit 1
}
echo "release gate: strict clean build, units, $passed integration fixtures and spec lint passed"
