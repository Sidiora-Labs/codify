#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
make -s build/libcg.a
test_bin="$(mktemp)"
trap 'rm -f "$test_bin"' EXIT
cc -std=gnu11 -Wall -Wextra -Isrc -Itests/fixtures/ast_runtime/json \
    -Ivendor/tree-sitter/lib/include \
    -o "$test_bin" tests/fixtures/ast_runtime/test_runtime.c \
    tests/fixtures/ast_runtime/json/parser.c build/libcg.a \
    -lsqlite3 -lpthread -lm
"$test_bin"
echo "ast runtime: pinned grammar, syntax walk, bounds and concurrent parsers passed"
