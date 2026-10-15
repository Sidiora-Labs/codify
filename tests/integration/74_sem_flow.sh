#!/usr/bin/env bash
# Bounded traversal over branch-scoped typed facts and unresolved references.
. "$(dirname "$0")/../lib.sh"

mkdir -p "$TMP/proj"
cd "$TMP/proj"
git init -q .
printf '.codegraph/\n' > .gitignore
cat > flow.c <<'EOF'
int start_node(void) { return 1; }
int middle_node(void) { return 2; }
int end_node(void) { return 3; }
int side_node(void) { return 4; }
EOF
"$CG" init >/dev/null
python3 - <<'PY'
import sqlite3
db = sqlite3.connect('.codegraph/graph.db')
syms = dict(db.execute("SELECT name,id FROM symbols WHERE name IN "
                       "('start_node','middle_node','end_node','side_node')"))
assert len(syms) == 4, syms
branch, file_id = db.execute("SELECT branch_id,id FROM files WHERE path='flow.c'").fetchone()
def edge(src, dst, kind='calls', provenance='syntax'):
    db.execute("INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,"
               "source_id,target_id,kind,original_text,strategy,provenance,evidence,"
               "channel,registration_path,registration_line,start_line,start_column,"
               "synthesized) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (branch,file_id,file_id,syms[src],syms[dst],kind,dst,
                'exact_owner',provenance,'registration at flow.c:3',
                'dispatch','flow.c',3,1,4,provenance=='heuristic'))
edge('start_node','middle_node')
edge('middle_node','end_node','calls','heuristic')
edge('start_node','side_node','type','syntax')
db.execute("INSERT INTO semantic_references(ref_id,file_id,ordinal,owner_id,"
           "target_id,original_text,kind,strategy,evidence,start_line) "
           "VALUES(900001,?,1,?,NULL,'dynamic_target','call','unresolved',"
           "'receiver type unknown',2)",(file_id,syms['middle_node']))
db.commit()
PY

"$CG" flow paths start_node end_node --json > "$TMP/path.json"
python3 - "$TMP/path.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); assert d['found'] and len(d['path'])==3,d
assert any(e['provenance']=='heuristic' and e['heuristic'] and
           e['evidence'] and e['path']=='flow.c'
           and e['registration_path']=='flow.c' and e['registration_line']==3
           for e in d['edges']),d
assert any(b['text']=='dynamic_target' and b['strategy']=='unresolved'
           for b in d['boundaries']),d
assert all(e['kind']!='type' or e['source'] in d['path'] for e in d['edges']),d
PY
"$CG" flow paths start_node end_node --depth 1 --json > "$TMP/shallow.json"
python3 - "$TMP/shallow.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); assert not d['found'] and d['truncated']['depth'],d
PY
"$CG" flow callees start_node --max-edges 1 --json > "$TMP/cap.json"
python3 - "$TMP/cap.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); assert len(d['edges'])<=1 and d['truncated']['edges'],d
PY
"$CG" flow callees start_node --max-nodes 1 --json > "$TMP/nodes.json"
python3 - "$TMP/nodes.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); assert len(d['nodes'])==1 and d['truncated']['nodes'],d
PY
"$CG" flow callees start_node --json > "$TMP/callees.json"
python3 - "$TMP/callees.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); names={n['name'] for n in d['nodes']}
assert 'middle_node' in names and 'side_node' not in names,d
assert all(e['kind']=='calls' for e in d['edges']),d
PY
"$CG" flow impact end_node --json > "$TMP/impact.json"
python3 - "$TMP/impact.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); names={n['name'] for n in d['nodes']}
assert {'start_node','middle_node','end_node'} <= names,d
PY
"$CG" flow callers start_node --json > "$TMP/callers.json"
python3 - "$TMP/callers.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); assert len(d['nodes'])==1 and not d['edges'],d
PY
"$CG" flow paths start_node end_node --max-output 1024 --json > "$TMP/output.json"
python3 - "$TMP/output.json" <<'PY'
import json,sys
p=open(sys.argv[1]).read(); d=json.loads(p)
d.pop('index_health',None)
payload=json.dumps(d,separators=(',',':')).encode()
assert len(payload)<=1024 and (d.get('truncated',{}).get('output') or d.get('error')),d
PY
"$CG" tool call flow '{"mode":"paths","name":"start_node","target":"end_node"}' \
    > "$TMP/mcp.json"
python3 - "$TMP/mcp.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); assert d['found'] and len(d['path'])==3,d
PY
echo "74_sem_flow: ok"
