# shared helpers for integration tests — source from integration/*.sh
set -euo pipefail

: "${CG:?CG env var must point to the cg binary}"
FIXTURES="$(cd "$(dirname "$0")/../fixtures" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

# has "<haystack>" "<needle>" — assert substring (fixed string)
has() {
    printf '%s' "$1" | grep -qF -- "$2" \
        || fail "expected '$2' in output:
$(printf '%s' "$1" | head -8)"
}

# hasnt "<haystack>" "<needle>"
hasnt() {
    if printf '%s' "$1" | grep -qF -- "$2"; then
        fail "did not expect '$2' in output"
    fi
}

# expect_rc <want> <cmd...> — run a command that may fail under set -e
expect_rc() {
    local want="$1" rc=0
    shift
    "$@" >/dev/null 2>&1 || rc=$?
    [ "$rc" -eq "$want" ] || fail "expected exit $want from '$*', got $rc"
}
