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

# has "<haystack>" "<needle>" — assert substring (fixed string).
# Matched in the shell, not through a pipe: `grep -q` exits at the first hit and
# a large haystack then loses the rest of the write to SIGPIPE, which pipefail
# turns into a spurious failure (and, in hasnt, a silent pass).
has() {
    case "$1" in
        *"$2"*) : ;;
        *) fail "expected '$2' in output:
$(printf '%s\n' "$1" | head -8)" ;;
    esac
}

# hasnt "<haystack>" "<needle>"
hasnt() {
    case "$1" in
        *"$2"*) fail "did not expect '$2' in output" ;;
    esac
}

# expect_rc <want> <cmd...> — run a command that may fail under set -e
expect_rc() {
    local want="$1" rc=0
    shift
    "$@" >/dev/null 2>&1 || rc=$?
    [ "$rc" -eq "$want" ] || fail "expected exit $want from '$*', got $rc"
}
