#!/usr/bin/env bash
# cg watch: inotify auto-sync picks up new files (Linux only)
. "$(dirname "$0")/../lib.sh"

if [ "$(uname -s)" != "Linux" ]; then
    echo "skip: watch test is Linux-only"
    exit 0
fi

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

"$CG" watch --debounce 100 >/dev/null 2>&1 &
WATCH_PID=$!
trap 'kill $WATCH_PID 2>/dev/null || true; wait $WATCH_PID 2>/dev/null || true; rm -rf "$TMP"' EXIT
sleep 1

cat > src/watched.ts <<'EOF'
export function watchSentinel(): string { return "seen"; }
EOF

found=0
for _ in $(seq 1 40); do
    if "$CG" search watchSentinel 2>/dev/null | grep -q "src/watched.ts"; then
        found=1
        break
    fi
    sleep 0.25
done
[ "$found" -eq 1 ] || fail "watcher did not index src/watched.ts within 10s"

# deletion is picked up too
rm src/watched.ts
gone=0
for _ in $(seq 1 40); do
    if ! "$CG" search watchSentinel 2>/dev/null | grep -q "src/watched.ts"; then
        gone=1
        break
    fi
    sleep 0.25
done
[ "$gone" -eq 1 ] || fail "watcher did not purge deleted file within 10s"

echo ok
