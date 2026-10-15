#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
${CC:-cc} -std=gnu11 -Wall -Wextra -Werror -Isrc \
  tests/integration/67_sem_types_case.c src/sem_types.c -lsqlite3 -o "$tmp/check"
"$tmp/check"
