#!/bin/sh
# Build on a remote executor; publication is a separate operation.
set -eu
if [ "${HYPERFIDE_BUILD_PLACEMENT:-}" != remote ]; then
    echo "Hyperfide releases must be built on a remote executor." >&2
    exit 78
fi
case "${1:-}" in
    --output) ;;
    *) echo "Usage: scripts/build-hyperfide-release.sh --output DIR [--skip-tests]" >&2; exit 64 ;;
esac
exec sh "$(dirname "$0")/release.sh" "$@"
