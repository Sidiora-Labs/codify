#!/bin/sh
# Compatibility shim for integrations requiring a script. Never consult PATH.
set -eu
dir=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)
target="$dir/hyperfide"
[ -x "$target" ] || { echo "hyperfide: canonical executable is missing beside this entrypoint" >&2; exit 127; }
[ ! "$target" -ef "$0" ] || { echo "hyperfide: recursive compatibility entrypoint refused" >&2; exit 126; }
exec "$target" "$@"
