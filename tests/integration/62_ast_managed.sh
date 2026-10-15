#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
make -s -j1 build/libcg.a
test_bin="$(mktemp)"
trap 'rm -f "$test_bin"' EXIT
cc -std=gnu11 -Wall -Wextra -Werror -Isrc \
   -Ivendor/tree-sitter/lib/include \
   -o "$test_bin" tests/fixtures/semantic/managed/test_managed.c \
   build/libcg.a -lsqlite3 -lpthread -lm
"$test_bin" tests/fixtures/semantic/managed
