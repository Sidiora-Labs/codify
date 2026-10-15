#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
cc -std=gnu11 -Wall -Wextra -Werror -I"$root/src" \
  "$root/tests/fixtures/semantic/dispatch/harness.c" \
  "$root/src/sem_dispatch.c" -lsqlite3 -o "$out"
"$out"
