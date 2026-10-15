#!/usr/bin/env bash
# Reconciliation debt survives process restart and watcher coverage loss.
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

cat > "$TMP/health_probe.c" <<'EOF'
#include "watch_health.h"
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
    if (argc != 3) return 2;
    Cg cg = {0};
    snprintf(cg.root, sizeof cg.root, "%s", argv[1]);
    snprintf(cg.shared, sizeof cg.shared, "%s", argv[1]);
    WatchHealth h;
    if (!watch_health_read(&cg, &h)) return 3;
    if (!strcmp(argv[2], "mark")) return watch_health_mark(&cg, "queue_overflow") ? 0 : 4;
    if (!strcmp(argv[2], "clear")) return watch_health_clear_if(&cg, h.generation) ? 0 : 5;
    printf("%d %llu %s\n", h.pending, h.generation, h.reason);
    return 0;
}
EOF
cc -std=gnu11 -Isrc -I"$(dirname "$CG")/src" \
   "$TMP/health_probe.c" "$(dirname "$CG")/src/watch_health.c" \
   -o "$TMP/health_probe"
probe() { "$TMP/health_probe" "$PWD" "$1"; }
has "$(probe read)" '0 0'
probe mark
has "$(probe read)" '1 1 queue_overflow'
probe mark
has "$(probe read)" '1 2 queue_overflow'
probe clear
has "$(probe read)" '0 2 reconciled'

if [ "$(uname -s)" != Linux ]; then
    echo 'ok (portable marker; event test requires Linux)'
    exit 0
fi

CG_WATCH_POLL_MS=1000 CG_WATCH_TEST_EVENT=queue_overflow \
CG_WATCH_TEST_SYNC_FAIL_ONCE=1 \
    "$CG" watch --debounce 100 >"$TMP/watch.log" 2>&1 &
watch_pid=$!
trap 'kill "$watch_pid" 2>/dev/null || true; wait "$watch_pid" 2>/dev/null || true; rm -rf "$TMP"' EXIT
for _ in $(seq 1 30); do
    [ "$(probe read | cut -d' ' -f1)" = 1 ] && break
    sleep 0.05
done
[ "$(probe read | cut -d' ' -f1)" = 1 ] || fail 'reconciliation debt was not durable during retry'
for _ in $(seq 1 80); do
    if [ "$(probe read | cut -d' ' -f1)" = 0 ] && \
       grep -q 'coverage recovered' "$TMP/watch.log"; then break; fi
    sleep 0.1
done
has "$(cat "$TMP/watch.log")" 'coverage degraded (queue_overflow)'
has "$(cat "$TMP/watch.log")" 'coverage degraded (sync_error)'
has "$(cat "$TMP/watch.log")" 'coverage recovered after full reconciliation'
has "$(probe read)" 'reconciled'

# A directory moved under an existing watched tree must be picked up at its
# new path. Direct database reads avoid a read command performing the sync.
mkdir -p src/moving
printf 'export function movedSentinel() { return 1; }\n' > src/moving/test.ts
for _ in $(seq 1 80); do
    count="$(sqlite3 .codegraph/graph.db "SELECT count(*) FROM symbols WHERE name='movedSentinel'")"
    [ "$count" -ge 1 ] && break
    sleep 0.1
done
[ "$count" -ge 1 ] || fail 'new directory was not indexed'
mv src/moving src/relocated
for _ in $(seq 1 80); do
    count="$(sqlite3 .codegraph/graph.db "SELECT count(*) FROM files WHERE path='src/relocated/test.ts'")"
    [ "$count" -ge 1 ] && break
    sleep 0.1
done
[ "$count" -ge 1 ] || fail 'moved directory was not indexed at new path'

kill "$watch_pid" 2>/dev/null || true
wait "$watch_pid" 2>/dev/null || true

for event in registration_error root_loss; do
    CG_WATCH_POLL_MS=200 CG_WATCH_TEST_EVENT="$event" \
        "$CG" watch --debounce 100 >"$TMP/$event.log" 2>&1 &
    watch_pid=$!
    for _ in $(seq 1 80); do
        grep -q 'coverage recovered' "$TMP/$event.log" && break
        sleep 0.1
    done
    has "$(cat "$TMP/$event.log")" "coverage degraded ($event)"
    has "$(cat "$TMP/$event.log")" 'coverage recovered after full reconciliation'
    kill "$watch_pid" 2>/dev/null || true
    wait "$watch_pid" 2>/dev/null || true
done
echo ok
