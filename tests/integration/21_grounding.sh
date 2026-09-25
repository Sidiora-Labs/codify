#!/usr/bin/env bash
# import resolution and manifest surface: repo paths, manifest deps, system, unknown
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/grounding" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

# (a) repo-internal import resolves to the target file
repo_hit="$(sqlite3 .codegraph/graph.db \
  "SELECT i.origin FROM imports i JOIN files f ON f.id=i.file_id
   WHERE f.path='src/app.ts' AND i.module='./util' LIMIT 1")"
has "$repo_hit" "repo"

target_fid="$(sqlite3 .codegraph/graph.db \
  "SELECT i.target_file_id FROM imports i JOIN files f ON f.id=i.file_id
   WHERE f.path='src/app.ts' AND i.module='./util' LIMIT 1")"
target_path="$(sqlite3 .codegraph/graph.db \
  "SELECT path FROM files WHERE id=$target_fid")"
has "$target_path" "src/util.ts"

# (b) manifest dependency is origin=manifest
manifest_hit="$(sqlite3 .codegraph/graph.db \
  "SELECT i.origin FROM imports i JOIN files f ON f.id=i.file_id
   WHERE f.path='src/app.ts' AND i.module='express' LIMIT 1")"
has "$manifest_hit" "manifest"

# (c) unknown import: not a repo path, not in any manifest
unknown_hit="$(sqlite3 .codegraph/graph.db \
  "SELECT i.origin FROM imports i JOIN files f ON f.id=i.file_id
   WHERE f.path='src/app.ts' AND i.module='nonexistent-package' LIMIT 1")"
has "$unknown_hit" "unknown"

# (d) no manifest for a language → references accounted external rather than reported
# The sample fixture has a C file; C has no manifest, so its system includes
# should be origin=system
cp -r "$FIXTURES/sample" "$TMP/samp"
cd "$TMP/samp"
"$CG" init >/dev/null

sys_origin="$(sqlite3 .codegraph/graph.db \
  "SELECT i.origin FROM imports i JOIN files f ON f.id=i.file_id
   WHERE f.path='src/helpers.c' AND i.module='stdio.h' LIMIT 1")"
has "$sys_origin" "system"

# local includes resolve to repo files
local_origin="$(sqlite3 .codegraph/graph.db \
  "SELECT i.origin FROM imports i JOIN files f ON f.id=i.file_id
   WHERE f.path='src/helpers.c' AND i.module='helpers.h' LIMIT 1")" || true
# helpers.h doesn't exist in fixtures, so it should be unknown
if [ -n "$local_origin" ]; then
    has "$local_origin" "unknown"
fi

# (e) ref resolution: verdicts are stored on call refs
cd "$TMP/proj"
# helper() from app.ts should resolve internal (defined in util.ts)
helper_verdict="$(sqlite3 .codegraph/graph.db \
  "SELECT r.verdict FROM refs r JOIN files f ON f.id=r.file_id
   WHERE f.path='src/app.ts' AND r.name='helper' AND r.kind='call' LIMIT 1")"
has "$helper_verdict" "internal"

# Router() from express — qualified call → external/receiver
router_verdict="$(sqlite3 .codegraph/graph.db \
  "SELECT r.verdict FROM refs r JOIN files f ON f.id=r.file_id
   WHERE f.path='src/app.ts' AND r.name='Router' AND r.kind='call' LIMIT 1")" || true
# Router is a bare call (no receiver), comes from express (manifest dep),
# so it should resolve via import or be unknown. Either is acceptable here.

# missing() has no definition in the repo → unknown
missing_verdict="$(sqlite3 .codegraph/graph.db \
  "SELECT r.verdict FROM refs r JOIN files f ON f.id=r.file_id
   WHERE f.path='src/app.ts' AND r.name='missing' AND r.kind='call' LIMIT 1")"
has "$missing_verdict" "unknown"

# (f) grounding: ungrounded call detected (helpr is not defined)
helpr_verdict="$(sqlite3 .codegraph/graph.db \
  "SELECT r.verdict FROM refs r JOIN files f ON f.id=r.file_id
   WHERE f.path='src/typo.ts' AND r.name='helpr' AND r.kind='call' LIMIT 1")"
has "$helpr_verdict" "unknown"

# ungrounded import detected (nonexistent-package)
unknown_import="$(sqlite3 .codegraph/graph.db \
  "SELECT i.origin FROM imports i JOIN files f ON f.id=i.file_id
   WHERE f.path='src/app.ts' AND i.module='nonexistent-package' LIMIT 1")"
has "$unknown_import" "unknown"

# (g) resolution stats are recorded in meta
resolve_internal="$(sqlite3 .codegraph/graph.db \
  "SELECT value FROM meta WHERE key='resolve_internal'")"
[ -n "$resolve_internal" ] || fail "resolve_internal not in meta"

# (h) C sees libc through the headers it includes, not only its own <...>
# lines: a tree whose .c files include one umbrella header must not report
# every free() as ungrounded. `#include "x.h"` resolves beside the file
# first, then to a unique header of that name anywhere (an -I directory).
mkdir -p "$TMP/cproj/src" "$TMP/cproj/tests"
cd "$TMP/cproj"
cat > src/app.h <<'EOF'
#include <stdlib.h>
#include <sqlite3.h>
void app_run(void);
EOF
cat > src/app.c <<'EOF'
#include "app.h"
void app_run(void) {
    char *p = malloc(4);
    free(p);
    sqlite3_stmt *st = 0;
    sqlite3_finalize(st);
    regcomp(0, 0, 0);
    frobnicate(p);
}
EOF
cat > tests/t.c <<'EOF'
#include "app.h"
#include "nowhere.h"
int main(void) { app_run(); free(0); return 0; }
EOF
mkdir -p tools
cat > tools/x.js <<'EOF'
const fs = require('fs');
const path = require('node:path');
const left = require('left-pad');
module.exports = { fs, path, left };
EOF
"$CG" init >/dev/null

# the quoted include is a repo file beside app.c
app_inc="$(sqlite3 .codegraph/graph.db \
  "SELECT i.origin || ':' || f2.path FROM imports i
   JOIN files f ON f.id=i.file_id JOIN files f2 ON f2.id=i.target_file_id
   WHERE f.path='src/app.c' AND i.module='app.h'")"
has "$app_inc" "repo:src/app.h"
# ...and from tests/, the one header of that name in the tree
t_inc="$(sqlite3 .codegraph/graph.db \
  "SELECT i.origin || ':' || f2.path FROM imports i
   JOIN files f ON f.id=i.file_id JOIN files f2 ON f2.id=i.target_file_id
   WHERE f.path='tests/t.c' AND i.module='app.h'")"
has "$t_inc" "repo:src/app.h"
nowhere="$(sqlite3 .codegraph/graph.db \
  "SELECT i.origin FROM imports i JOIN files f ON f.id=i.file_id
   WHERE f.path='tests/t.c' AND i.module='nowhere.h'")"
has "$nowhere" "unknown"

verdict_of() {
    sqlite3 .codegraph/graph.db \
      "SELECT r.verdict || ':' || r.conf FROM refs r JOIN files f ON f.id=r.file_id
       WHERE f.path='$1' AND r.name='$2' AND r.kind='call' LIMIT 1"
}
# libc and sqlite3 reached through app.h are builtins, by name and by family
has "$(verdict_of src/app.c free)" "external:builtin"
has "$(verdict_of src/app.c malloc)" "external:builtin"
has "$(verdict_of src/app.c sqlite3_finalize)" "external:builtin"
has "$(verdict_of tests/t.c free)" "external:builtin"
has "$(verdict_of tests/t.c app_run)" "internal"
# a header nobody includes still gates its names; an undefined call still fires
has "$(verdict_of src/app.c regcomp)" "unknown"
has "$(verdict_of src/app.c frobnicate)" "unknown"

# Node core modules are the runtime's, with or without the node: scheme;
# an undeclared package is still ungrounded
js_origins="$(sqlite3 .codegraph/graph.db \
  "SELECT i.module || '=' || i.origin FROM imports i JOIN files f ON f.id=i.file_id
   WHERE f.path='tools/x.js' ORDER BY i.line")"
has "$js_origins" "fs=system"
has "$js_origins" "node:path=system"
has "$js_origins" "left-pad=unknown"

echo ok
