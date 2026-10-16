#!/bin/sh
# Actual bundled CPython has its own dependency closure; never consult PATH.
set -eu
case "$0" in /*) ;; *) echo "hyperfide: absolute packaged Python path required" >&2; exit 78 ;; esac
directory=${0%/*}
root=$(CDPATH= cd -P -- "$directory/.." && pwd)
target="$root/bin/python3.bin"
[ -f "$target" ] && [ ! -L "$target" ] && [ -x "$target" ] || exit 78
unset PYTHONHOME PYTHONPATH PYTHONSTARTUP PYTHONUSERBASE
LD_LIBRARY_PATH="$root/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH
exec "$target" -B "$@"
