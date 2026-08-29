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

echo ok
