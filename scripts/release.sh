#!/usr/bin/env bash
# Build the static release binary and publish it plus the install scripts
# to the web root served at https://codify.centra.ag.
# Usage: scripts/release.sh [webroot]   (default /var/www/codify)
set -euo pipefail

cd "$(dirname "$0")/.."
WEBROOT="${1:-/var/www/codify}"

echo "== static build"
make clean >/dev/null
make CFLAGS="-O2 -std=gnu11 -Wall -Wextra -pthread" \
     LDLIBS="-static -lsqlite3 -lpthread -lm -ldl" >/dev/null
strip cg
file cg | grep -q "statically linked" || { echo "release: binary is not static" >&2; exit 1; }

echo "== integration tests against the release binary"
CG="$PWD/cg" tests/run.sh >/dev/null || { echo "release: tests failed" >&2; exit 1; }

ver="$(./cg --version)"
echo "== publishing cg $ver to $WEBROOT"
mkdir -p "$WEBROOT"
install -m 755 cg "$WEBROOT/cg.new"
mv -f "$WEBROOT/cg.new" "$WEBROOT/cg"          # atomic swap for live downloads
sha256sum "$WEBROOT/cg" | awk '{print $1"  cg"}' > "$WEBROOT/cg.sha256"
printf '%s\n' "$ver" > "$WEBROOT/VERSION"
install -m 644 scripts/install.sh   "$WEBROOT/install"
install -m 644 scripts/uninstall.sh "$WEBROOT/uninstall"
install -m 644 scripts/index.html   "$WEBROOT/index.html"

# rebuild the normal (dynamic) dev binary so the working tree is back to default
make >/dev/null

echo "== published:"
ls -la "$WEBROOT"
