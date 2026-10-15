#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
${CC:-cc} -std=gnu11 -Wall -Wextra -Werror -Isrc \
  tests/integration/67_sem_types_case.c src/sem_types.c -lsqlite3 -o "$tmp/check"
"$tmp/check"

cat > "$tmp/Hierarchy.java" <<'EOF'
interface Runner { void run(); }
class Base { }
class Child extends Base implements Runner {
    public Base get() { return new Base(); }
    public void run() {}
}
EOF
cat > "$tmp/Hierarchy.cpp" <<'EOF'
class Root { public: virtual int run() { return 1; } };
class Leaf : public Root { public: int run() override { return 2; } };
EOF
cat > "$tmp/Decorators.ts" <<'EOF'
function Audit(target: unknown): unknown { return target; }
function route(path: string) { return function apply(target: unknown) { return target; }; }
@Audit
class DecoratedPanel {}
@route('/panel')
class RoutedPanel {}
@Tag
class AmbiguousPanel {}
EOF
cat > "$tmp/a.ts" <<'EOF'
export function Tag(target: unknown): unknown { return target; }
EOF
cat > "$tmp/b.ts" <<'EOF'
export function Tag(target: unknown): unknown { return target; }
EOF
binary=${CG:-$PWD/cg}
(cd "$tmp" && "$binary" init --nested >/dev/null)
python3 - "$tmp" <<'PY'
import sqlite3
import sys
from pathlib import Path

db_paths = list(Path(sys.argv[1]).glob('.*/graph.db'))
assert len(db_paths) == 1, db_paths
db = sqlite3.connect(db_paths[0])
edges = set(db.execute("""
    SELECT e.kind, s.name, t.name FROM semantic_edges e
    JOIN symbols s ON s.id=e.source_id
    JOIN symbols t ON t.id=e.target_id
    WHERE e.strategy='type_hierarchy'
"""))
expected = {
    ('inherits', 'Child', 'Base'),
    ('implements', 'Child', 'Runner'),
    ('inherits', 'Leaf', 'Root'),
    ('returns', 'get', 'Base'),
    ('overrides', 'run', 'run'),
    ('decorates', 'DecoratedPanel', 'Audit'),
    ('decorates', 'RoutedPanel', 'route'),
}
assert expected <= edges, (expected - edges, edges)
ambiguous = list(db.execute("""
    SELECT e.id FROM semantic_edges e JOIN symbols s ON s.id=e.source_id
    WHERE e.kind='decorates' AND s.name='AmbiguousPanel'
"""))
assert not ambiguous, ambiguous
duplicates = list(db.execute("""
    SELECT source_id,target_id,kind,count(*) FROM semantic_edges
    WHERE kind='contains' GROUP BY source_id,target_id,kind HAVING count(*)>1
"""))
assert not duplicates, duplicates
print('real-source type relations: pass')
PY
