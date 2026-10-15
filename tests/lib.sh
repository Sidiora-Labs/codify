# shared helpers for integration tests — source from integration/*.sh
set -euo pipefail

: "${CG:?CG env var must point to the cg binary}"
# No test may reach the network. Jev's key is dropped for every test here;
# 28_jev.sh exports its own against the fake curl in fixtures/jev.
unset OPENROUTER_API_KEY
FIXTURES="$(cd "$(dirname "$0")/../fixtures" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Every direct read of a graph.db waits for a lock instead of failing on it.
# cg forks detached projection builds (projection_auto_build, after discovery
# and the post-edit hook) that write the same file, and the sqlite3 shell has
# no busy timeout of its own: under suite load a query that opens the graph
# while such a build commits or checkpoints gets "database is locked" and an
# assertion fails on an empty result. 50_discover showed it 2 runs in 20.
sqlite3() { command sqlite3 -cmd '.timeout 5000' "$@"; }

# Integration fixtures discover the index location after initialization.
graph_db() {
    local paths=(.*/graph.db)
    [ "${#paths[@]}" -eq 1 ] && [ -f "${paths[0]}" ] || return 1
    printf '%s\n' "${paths[0]}"
}

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
