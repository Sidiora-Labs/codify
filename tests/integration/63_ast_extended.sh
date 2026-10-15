#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
make -j1 build/libcg.a >/dev/null
cc -std=gnu11 -Wall -Wextra -pthread -Isrc -Ivendor/tree-sitter/lib/include \
  tests/fixtures/semantic/extended/assert.c build/libcg.a \
  -lsqlite3 -lpthread -lm -o build/test_ast_extended
./build/test_ast_extended
