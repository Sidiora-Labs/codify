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
echo "semantic route graph: OK"
