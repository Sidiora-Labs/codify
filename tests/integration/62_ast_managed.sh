#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
make -s -j1 build/libcg.a
test_bin="$(mktemp)"
test_root="$(mktemp -d)"
trap 'rm -f "$test_bin"; rm -rf "$test_root"' EXIT
cc -std=gnu11 -Wall -Wextra -Werror -Isrc \
   -Ivendor/tree-sitter/lib/include \
   -o "$test_bin" tests/fixtures/semantic/managed/test_managed.c \
   build/libcg.a -lsqlite3 -lpthread -lm
"$test_bin" tests/fixtures/semantic/managed
cp tests/fixtures/semantic/managed/Box.* "$test_root/"
git -C "$test_root" init -q
(cd "$test_root" && "$CG" init --nested >/dev/null)
db="$(find "$test_root" -type f -name graph.db -print -quit)"
symbols="$(sqlite3 "$db" 'SELECT count(*) FROM semantic_symbols')"
refs="$(sqlite3 "$db" 'SELECT count(*) FROM semantic_references')"
bindings="$(sqlite3 "$db" 'SELECT count(*) FROM semantic_bindings')"
facts="$(sqlite3 "$db" 'SELECT count(*) FROM semantic_type_facts')"
[[ "$symbols" -ge 24 && "$refs" -ge 6 && "$bindings" -ge 6 && "$facts" -ge 12 ]] || {
    echo "managed index persistence incomplete: $symbols symbols, $refs refs, $bindings bindings, $facts facts" >&2
    exit 1
}
echo "managed index persistence: $symbols symbols, $refs refs, $bindings bindings, $facts facts"
