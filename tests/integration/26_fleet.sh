#!/usr/bin/env bash
# fleet: the hierarchy that turns one repository into a tree of agents.
#   roles     — [hierarchy]/[role.*] parsing with defaults, CG_ROLE/CG_PARENT
#               identity in claims, brief, and the agents registry,
#               cg fleet roles|status|plan text and JSON
#   branches  — (task 2.2) worker/feature/main branch lifecycle
#   orchestrate — (task 2.3) two-level spec run --fleet
# Run one section: 26_fleet.sh roles
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

setup_repo() {
    rm -rf "$TMP/proj"
    mkdir -p "$TMP/proj/src" "$TMP/proj/lib" "$TMP/proj/docs"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    echo 'export function alpha(){}' > src/a.ts
    echo 'export function beta(){}'  > lib/b.ts
    echo '# doc' > docs/d.md
    "$CG" spec new fleet >/dev/null
    "$CG" spec start 1.1 >/dev/null
    "$CG" spec done 1.1 >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha work" --wave 1 --touches 'src/*.ts' \
          --reqs 1.1 >/dev/null
    "$CG" spec add 2.2 --title "Beta work" --wave 1 --touches 'lib/*.ts' \
          --reqs 1.1 >/dev/null
    "$CG" spec add 3.1 --title "Docs work" --wave 2 --touches 'docs/*.md' \
          --reqs 1.1 >/dev/null
    "$CG" init >/dev/null
    git add -A >/dev/null; git commit -qm base >/dev/null
}

if want roles; then
    setup_repo

    # ---- no [hierarchy]: defaults are shown, not configured, not enabled
    out="$("$CG" fleet roles)"
    has "$out" "hierarchy: not configured"
    has "$out" "gideon"
    has "$out" "fm-{feature}"
    has "$out" "wave/{feature}/{wave}"
    has "$out" "feature/{feature}"
    out="$("$CG" fleet roles --json)"
    echo "$out" | pyjson '
assert d["configured"] is False and d["enabled"] is False, d
assert d["main"] == "main" and d["remote"] == "origin", d
assert d["pr"] == "auto" and d["checkpoint"] == "manual", d
assert d["test_gate"] == "make test" and d["lint_gate"] == "", d
names = [r["name"] for r in d["roles"]]
assert names == ["main", "feature", "worker"], names
w = d["roles"][2]
assert w["agent"] == "w-{feature}-{wave}", w
assert w["branch"] == "wave/{feature}/{wave}" and w["base"] == "feature/{feature}", w
f = d["roles"][1]
assert f["branch"] == "feature/{feature}" and f["base"] == "{main}", f
assert d["roles"][0]["base"] == "", d["roles"][0]
' || fail "default roles JSON"

    # ---- [hierarchy] + partial [role.*] override the defaults, rest kept
    cat >> spec/workflow.kvx <<'EOF'

[hierarchy]
main       = "trunk"
remote     = "upstream"
test_gate  = "npm test"
lint_gate  = "npm run lint"
pr         = "manual"
checkpoint = "auto"

[role.main]
agent = "gideon-prime"

[role.worker]
branch = "work/{feature}-{wave}"

[role.bogus]
agent = "nobody"
EOF
    out="$("$CG" fleet roles)"
    has "$out" "hierarchy: enabled"
    has "$out" "main branch: trunk"
    has "$out" "remote: upstream"
    has "$out" "gideon-prime"
    has "$out" "work/{feature}-{wave}"
    has "$out" "fm-{feature}"
    has "$out" "npm run lint"
    has "$out" "[role.bogus] is not main, feature, or worker"
    out="$("$CG" fleet roles --json)"
    echo "$out" | pyjson '
assert d["configured"] is True and d["enabled"] is True, d
assert d["main"] == "trunk" and d["remote"] == "upstream", d
assert d["pr"] == "manual" and d["checkpoint"] == "auto", d
assert d["lint_gate"] == "npm run lint", d
r = {x["name"]: x for x in d["roles"]}
assert r["main"]["agent"] == "gideon-prime", r
assert r["main"]["branch"] == "{main}", r
assert r["worker"]["branch"] == "work/{feature}-{wave}", r
assert r["worker"]["base"] == "feature/{feature}", r
assert r["feature"]["agent"] == "fm-{feature}", r
assert d["unknown_roles"] == ["bogus"], d
' || fail "override roles JSON"

    # ---- enabled = false keeps the config but switches the fleet off
    python3 - <<'EOF'
import re
p = "spec/workflow.kvx"
s = open(p).read()
s = s.replace('[hierarchy]\n', '[hierarchy]\nenabled = false\n', 1)
open(p, "w").write(s)
EOF
    out="$("$CG" fleet roles)"
    has "$out" "hierarchy: disabled"
    out="$("$CG" fleet roles --json)"
    echo "$out" | pyjson 'assert d["configured"] is True and d["enabled"] is False, d' \
        || fail "disabled JSON"
    python3 - <<'EOF'
p = "spec/workflow.kvx"
s = open(p).read().replace('enabled = false\n', '', 1)
open(p, "w").write(s)
EOF

    # ---- identity: a claim made with CG_ROLE/CG_PARENT surfaces in status
    CG_AGENT=w-fleet-1 CG_ROLE=worker CG_PARENT=fm-fleet CG_FEATURE=fleet CG_WAVE=1 \
        "$CG" spec claim 2.1 >/dev/null
    CG_AGENT=w-fleet-1 CG_ROLE=worker CG_PARENT=fm-fleet \
        "$CG" spec start 2.1 >/dev/null
    out="$("$CG" spec status --json)"
    echo "$out" | pyjson '
c = {x["id"]: x for x in d["claims"]}
assert c["2.1"]["agent"] == "w-fleet-1", c
assert c["2.1"]["role"] == "worker", c
assert c["2.1"]["parent"] == "fm-fleet", c
' || fail "claim role/parent JSON"
    out="$("$CG" spec status)"
    has "$out" "claimed by w-fleet-1 [worker under fm-fleet]"

    # a claim without a role has role null and no bracket
    CG_AGENT=solo "$CG" spec claim 2.2 >/dev/null
    out="$("$CG" spec status --json)"
    echo "$out" | pyjson '
c = {x["id"]: x for x in d["claims"]}
assert c["2.2"]["agent"] == "solo" and c["2.2"]["role"] is None, c
assert c["2.2"]["parent"] is None, c
' || fail "roleless claim JSON"
    out="$("$CG" spec status)"
    has "$out" "claimed by solo (attempt"

    # the registry only holds agents that declared a role
    rows="$(python3 - <<'EOF'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
print("|".join(f"{a}:{r}:{p}:{f}:{w}" for a, r, p, f, w in
      db.execute("SELECT agent,role,ifnull(parent,''),ifnull(feature,''),ifnull(wave,-1) "
                 "FROM agents ORDER BY agent")))
EOF
)"
    has "$rows" "w-fleet-1:worker:fm-fleet:fleet:1"
    hasnt "$rows" "solo"

    # ---- brief carries the identity block; solo brief has none
    out="$(CG_AGENT=w-fleet-1 CG_ROLE=worker CG_PARENT=fm-fleet "$CG" brief)"
    has "$out" "agent: w-fleet-1 — Wave Worker, reports to fm-fleet"
    out="$(CG_AGENT=w-fleet-1 CG_ROLE=worker CG_PARENT=fm-fleet "$CG" brief --json)"
    echo "$out" | pyjson '
a = d["agent"]
assert a["name"] == "w-fleet-1" and a["role"] == "worker", a
assert a["parent"] == "fm-fleet", a
' || fail "brief identity JSON"
    out="$(CG_AGENT=solo "$CG" brief)"
    hasnt "$out" "agent: solo"
    out="$(CG_AGENT=solo "$CG" brief --json)"
    echo "$out" | pyjson '
a = d["agent"]
assert a["name"] == "solo" and a["role"] is None and a["parent"] is None, a
' || fail "solo brief identity JSON"

    # ---- a manager and the main agent register by reading status
    CG_AGENT=fm-fleet CG_ROLE=feature CG_PARENT=gideon CG_FEATURE=fleet \
        "$CG" fleet status >/dev/null
    out="$(CG_AGENT=gideon CG_ROLE=main "$CG" fleet status)"
    has "$out" "you: gideon — Main Gideon"
    has "$out" "hierarchy: enabled"
    has "$out" "main     gideon"
    has "$out" "feature  fm-fleet"
    has "$out" "under gideon"
    has "$out" "worker   w-fleet-1"
    has "$out" "fleet wave 1"
    has "$out" "under fm-fleet"
    has "$out" "on fleet/2.1"
    has "$out" "solo"
    has "$out" "(no CG_ROLE)"
    out="$(CG_AGENT=gideon CG_ROLE=main "$CG" fleet status --json)"
    echo "$out" | pyjson '
assert d["you"] == {"name": "gideon", "role": "main", "parent": None}, d["you"]
assert d["hierarchy"]["enabled"] is True and d["hierarchy"]["main"] == "trunk", d
a = {x["agent"]: x for x in d["agents"]}
assert [x["agent"] for x in d["agents"]][:3] == ["gideon", "fm-fleet", "w-fleet-1"], d["agents"]
assert a["w-fleet-1"]["role"] == "worker" and a["w-fleet-1"]["parent"] == "fm-fleet", a
assert a["w-fleet-1"]["feature"] == "fleet" and a["w-fleet-1"]["wave"] == 1, a
assert a["w-fleet-1"]["tasks"] == ["fleet/2.1"], a
assert a["fm-fleet"]["role"] == "feature" and a["fm-fleet"]["tasks"] == [], a
assert a["solo"]["role"] is None and a["solo"]["tasks"] == ["fleet/2.2"], a
assert all(isinstance(x["seen"], int) for x in d["agents"]), d
' || fail "fleet status JSON"

    # a solo process sees the hint to join the fleet
    out="$(CG_AGENT=solo "$CG" fleet status)"
    has "$out" "you: solo — no role"
    has "$out" "CG_ROLE=main|feature|worker"

    # ---- plan: managers and wave workers, planned names and live owners
    out="$("$CG" fleet plan)"
    has "$out" "fleet plan — feature fleet (hierarchy enabled)"
    has "$out" "main      gideon-prime"
    has "$out" "trunk"
    has "$out" "feature   fm-fleet"
    has "$out" "feature/fleet"
    has "$out" "← trunk"
    has "$out" "wave 1    w-fleet-1"
    has "$out" "work/fleet-1"
    has "$out" "← feature/fleet"
    has "$out" "wave 2    w-fleet-2"
    has "$out" "work/fleet-2"
    has "$out" "2.1      in_progress  Alpha work"
    has "$out" "3.1      pending      Docs work"
    out="$("$CG" fleet plan --json)"
    echo "$out" | pyjson '
assert d["feature"] == "fleet", d
assert d["main"]["agent"] == "gideon-prime" and d["main"]["branch"] == "trunk", d["main"]
assert d["main"]["live"] == ["gideon"], d["main"]
fm = d["feature_manager"]
assert fm["agent"] == "fm-fleet" and fm["branch"] == "feature/fleet", fm
assert fm["base"] == "trunk" and fm["live"] == ["fm-fleet"], fm
w = {x["wave"]: x for x in d["waves"]}
assert sorted(w) == [0, 1, 2], w
assert [t["id"] for t in w[0]["tasks"]] == ["1.1"] and w[0]["tasks"][0]["status"] == "done", w[0]
assert w[1]["agent"] == "w-fleet-1" and w[1]["branch"] == "work/fleet-1", w[1]
assert w[1]["base"] == "feature/fleet", w[1]
assert sorted(w[1]["live"]) == ["solo", "w-fleet-1"], w[1]
assert [t["id"] for t in w[1]["tasks"]] == ["2.1", "2.2"], w[1]
assert {t["id"]: t["status"] for t in w[1]["tasks"]} == {"2.1": "in_progress", "2.2": "pending"}, w[1]
assert w[2]["live"] == [] and [t["id"] for t in w[2]["tasks"]] == ["3.1"], w[2]
' || fail "fleet plan JSON"

    # -f names another feature; an unknown one is a clean error
    expect_rc 1 "$CG" fleet plan -f nope
    err="$("$CG" fleet plan -f nope 2>&1 >/dev/null || true)"
    has "$err" "cannot parse"

    # a bad subcommand is usage
    expect_rc 1 "$CG" fleet bogus
fi

echo "ok 26_fleet ($section)"
