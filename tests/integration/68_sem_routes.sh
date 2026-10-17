#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/../lib.sh"

fixture="$(cd "$(dirname "$0")/../fixtures/semantic/routes" && pwd)"
repo="$TMP/routes"
mkdir -p "$repo"
cp -R "$fixture"/. "$repo"/
cd "$repo"
git init -q -b main
git config user.email route@test.invalid
git config user.name route
git add -A
git commit -qm initial
"$CG" init >/dev/null
dbs=("$repo"/.*/graph.db)
db="${dbs[0]}"

python3 - "$db" <<'PY'
import sqlite3,sys
d=sqlite3.connect(sys.argv[1])
q=lambda sql,*args: d.execute(sql,args).fetchall()
assert q("SELECT count(*) FROM semantic_route_facts")[0][0] >= 12
assert q("SELECT method,pattern FROM semantic_route_facts WHERE framework='nextjs-app' ORDER BY method") == [('GET','/orders'),('POST','/orders')]
assert q("SELECT method,pattern FROM semantic_route_facts WHERE framework='sveltekit' AND method='GET'") == [('GET','/notes')]
assert q("SELECT framework,method FROM semantic_route_facts WHERE pattern='/flask/get'") == [('flask','GET')]
for framework,method,path,handler in [
 ('expo-router','PAGE','/report','reportHandler'),
 ('sveltekit','PAGE','/report','load'),
 ('axum','GET','/rust/lifetime','lifetimeHandler'),
 ('react-router','PAGE','/react/object','RouteObjectHandler')]:
    assert q("SELECT s.name FROM semantic_route_facts r JOIN symbols s ON s.id=r.handler_symbol_id "
             "WHERE r.framework=? AND r.method=? AND r.pattern=? AND r.status='resolved'",
             framework,method,path) == [(handler,)],(framework,path)
    assert q("SELECT e.provenance FROM semantic_edges e "
             "JOIN semantic_route_facts r ON r.route_symbol_id=e.source_id "
             "WHERE e.kind='route_handler' AND r.framework=? AND r.method=? "
             "AND e.channel=?",framework,method,path) == [('resolved',)],path
for framework,path in [('express','/express/multiline'),('fastapi','/fastapi/multiline'),
                       ('spring','/spring/multiline'),('gin/echo','/gin/multiline')]:
    assert q("SELECT status FROM semantic_route_facts WHERE framework=? AND pattern=?",framework,path) == [('resolved',)],(framework,path)
assert q("SELECT status FROM semantic_route_facts WHERE framework='express' AND pattern='/express/long'") == [('resolved',)]
assert q("SELECT method,pattern FROM semantic_route_facts WHERE framework='nuxt' AND method='GET'") == [('GET','/api/widgets')]
assert not q("SELECT 1 FROM semantic_route_facts WHERE pattern IN "
             "('/ghost','/block-ghost','/template-ghost','/python-ghost',"
             "'/spring-block-ghost','/spring-string-ghost',"
             "'/gin-block-ghost','/gin-string-ghost','/string','/computed')")
assert q("SELECT count(*) FROM semantic_route_facts WHERE pattern='/express/duplicate'") == [(2,)]
assert q("SELECT method,status FROM semantic_route_facts WHERE pattern='/dynamic/${id}'") == [('DYNAMIC','dynamic')]
assert q("SELECT status FROM semantic_route_facts WHERE pattern='/express/items'") == [('resolved',)]
assert q("SELECT status FROM semantic_route_facts WHERE pattern='/express/unknown'") == [('unresolved',)]
assert q("SELECT count(*) FROM semantic_edges WHERE kind='route_handler'")[0][0] >= 1
assert q("SELECT strategy,provenance FROM semantic_edges WHERE kind='route_handler' "
         "AND channel='/rails/home'") == [('framework-convention','heuristic')]
assert q("SELECT strategy,provenance FROM semantic_edges WHERE kind='route_handler' "
         "AND channel='/express/items'") == [('route-registration','resolved')]
assert not q("SELECT e.id FROM semantic_edges e LEFT JOIN symbols a ON a.id=e.source_id "
             "LEFT JOIN symbols b ON b.id=e.target_id "
             "WHERE e.kind='route_handler' AND (a.kind!='route' OR b.id IS NULL)")
assert q("SELECT method,pattern FROM semantic_route_compositions WHERE pattern='/mounted/child'") == [('GET','/mounted/child')]
assert q("SELECT count(*) FROM semantic_edges WHERE kind='route_mount'")[0][0] == 1
assert q("SELECT channel FROM semantic_edges WHERE kind='route_navigation' ORDER BY channel") == [('/profile',),('/react/page',)]
for framework in ('express','nextjs','nextjs-app','sveltekit','nuxt','expo-router',
                  'react-router','vue-router','fastapi','flask','django','rails','laravel','spring',
                  'aspnet-attr','gin/echo','axum','vapor'):
    assert q("SELECT 1 FROM semantic_route_facts WHERE framework=?",framework),framework
for framework,path in [('express','/express/items'),('nextjs','/api/items'),
 ('nextjs-app','/orders'),('sveltekit','/notes'),('nuxt','/api/widgets'),
 ('expo-router','/profile'),('react-router','/react/page'),
 ('vue-router','/vue/account'),('fastapi','/fastapi/items'),
 ('flask','/flask/ping'),('django','/django/show'),('rails','/rails/home'),
 ('laravel','/laravel/home'),('spring','/spring/home'),
 ('aspnet-attr','/asp/home'),('gin/echo','/gin/list'),
 ('axum','/axum/list'),('vapor','/vapor/show')]:
    assert q("SELECT status FROM semantic_route_facts WHERE framework=? AND pattern=? LIMIT 1",framework,path) == [('resolved',)],(framework,path)
assert q("SELECT status FROM semantic_route_facts WHERE framework='nuxt' AND pattern='/account'") == [('dynamic',)]
PY

# Replacing a registration file must retire its old synthetic node before
# SQLite may reuse its row ID for an ordinary handler declaration.
printf '\n// comment-only edit\n' >> api.js
"$CG" sync >/dev/null
python3 - "$db" <<'PY'
import sqlite3,sys
d=sqlite3.connect(sys.argv[1])
bad=d.execute("SELECT r.pattern,r.route_symbol_id,s.kind,s.name "
              "FROM semantic_route_facts r LEFT JOIN symbols s ON s.id=r.route_symbol_id "
              "WHERE s.id IS NULL OR s.kind!='route' OR s.file_id!=r.registration_file_id "
              "OR s.name!=r.method||' '||r.pattern").fetchall()
assert not bad,bad
assert d.execute("SELECT count(*) FROM semantic_edges e JOIN semantic_route_facts r "
                 "ON r.route_symbol_id=e.source_id WHERE e.kind='route_handler' "
                 "AND e.channel='/express/items' AND e.target_id=r.handler_symbol_id").fetchone()==(1,)
PY

edge_before="$(python3 - "$db" <<'PY'
import sqlite3,sys
d=sqlite3.connect(sys.argv[1])
print(d.execute("SELECT id FROM semantic_edges WHERE kind='route_handler' ORDER BY id LIMIT 1").fetchone()[0])
PY
)"
sed -i 's/return 1/return 2/' src/misc.py
"$CG" sync >/dev/null
edge_after="$(python3 - "$db" <<'PY'
import sqlite3,sys
d=sqlite3.connect(sys.argv[1])
print(d.execute("SELECT id FROM semantic_edges WHERE kind='route_handler' ORDER BY id LIMIT 1").fetchone()[0])
PY
)"
[ "$edge_before" = "$edge_after" ] || fail "unrelated edit rebuilt route graph"

# Rewire only the registration. The old route and its edge must disappear.
sed -i "s@/express/items@/express/changed@" api.js
"$CG" sync >/dev/null
python3 - "$db" <<'PY'
import sqlite3,sys
d=sqlite3.connect(sys.argv[1])
assert not d.execute("SELECT 1 FROM semantic_route_facts WHERE pattern='/express/items'").fetchone()
assert d.execute("SELECT status FROM semantic_route_facts WHERE pattern='/express/changed'").fetchone() == ('resolved',)
assert not d.execute("SELECT 1 FROM semantic_edges WHERE kind='route_handler' AND channel='/express/items'").fetchone()
PY

# Competing declarations cannot be quietly broken by row order.
sed -i '1i function listItems(req, res) { return null; }' api.js
"$CG" sync >/dev/null
python3 - "$db" <<'PY'
import sqlite3,sys
d=sqlite3.connect(sys.argv[1])
assert d.execute("SELECT status FROM semantic_route_facts WHERE pattern='/express/changed'").fetchone() == ('ambiguous',)
assert not d.execute("SELECT 1 FROM semantic_edges WHERE kind='route_handler' AND channel='/express/changed'").fetchone()
PY

# A statement that exceeds the bounded buffer must degrade file coverage.
python3 - <<'PY'
with open('src/overflow.js','w') as f:
    f.write('function overflowHandler() {}\napp.get(\n')
    f.write('/*' + 'x'*8300 + '*/\n')
    f.write("  '/overflow', overflowHandler\n);\n")
PY
"$CG" sync >/dev/null
python3 - "$db" <<'PY'
import sqlite3,sys
d=sqlite3.connect(sys.argv[1])
row=d.execute("SELECT status,diagnostics FROM extraction_health "
              "WHERE path='src/overflow.js'").fetchone()
assert row and row[0]=='partial' and 'route_statement_limit' in row[1],row
assert not d.execute("SELECT 1 FROM semantic_route_facts WHERE pattern='/overflow'").fetchone()
PY

rm src/flask_get.py
"$CG" sync >/dev/null
python3 - "$db" <<'PY'
import sqlite3,sys
d=sqlite3.connect(sys.argv[1])
assert not d.execute("SELECT 1 FROM semantic_route_facts WHERE pattern='/flask/get'").fetchone()
assert not d.execute("SELECT 1 FROM semantic_edges WHERE kind='route_handler' "
                     "AND channel='/flask/get'").fetchone()
assert not d.execute("SELECT 1 FROM semantic_route_compositions c "
                     "LEFT JOIN semantic_route_facts r ON r.route_id=c.child_route_id "
                     "WHERE r.route_id IS NULL").fetchone()
assert not d.execute("SELECT 1 FROM semantic_route_dirty").fetchone()
PY

# dict.get(key, default) and *_path object keys are not route registrations.
precision="$TMP/route-precision"
mkdir -p "$precision"
cp -R "$(dirname "$fixture")/../routes"/. "$precision"/
cd "$precision"
git init -q -b main
"$CG" init >/dev/null
out="$("$CG" routes)"
for row in 'GET     /items' 'POST    /orders' 'DELETE  /users/{id}' 'PUT     /' \
           'GET     /health' 'PATCH   /orders/{id}' '/hapi/items' '/vue/account' \
           '/react/home'; do
    grep -qF -- "$row" <<<"$out" || fail "true-positive route missing: $row"$'\n'"$out"
done
if grep -E 'false_positives\.(py|mjs)' <<<"$out"; then
    fail "false-positive route extracted"
fi
echo "semantic route graph: OK"
