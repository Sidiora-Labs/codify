#!/usr/bin/env bash
# fleet: the hierarchy that turns one repository into a tree of agents.
#   roles     — [hierarchy]/[role.*] parsing with defaults, CG_ROLE/CG_PARENT
#               identity in claims, brief, and the agents registry,
#               cg fleet roles|status|plan text and JSON
#   branches  — the branch lifecycle: cg fleet begin (wave worktree +
#               branch + claim), merge-up into the feature branch with
#               conflicts by path, land on main behind the gates, the pull
#               request through gh (faked) or as printed commands, and the
#               checkpoint that merges open feature PRs in order
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
    printf '.codegraph/\n*.lock\n' > .gitignore
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

if want branches; then
    setup_repo
    proj="$(pwd -P)"
    wt="$proj/.codegraph/worktrees"
    cat >> spec/workflow.kvx <<'EOF'

[hierarchy]
test_gate = "sh gate.sh"
lint_gate = "sh lint.sh"
EOF
    printf 'test -f gate.ok\n' > gate.sh
    printf 'test -f lint.ok\n' > lint.sh
    git add -A >/dev/null; git commit -qm "hierarchy and gates" >/dev/null
    base_sha="$(git rev-parse HEAD)"

    # ---- begin: feature branch cut from main, wave branch + worktree, claim
    out="$("$CG" fleet begin 2.1)"
    has "$out" "begin 2.1 — wave 1 of fleet"
    has "$out" "agent:    w-fleet-1 (worker, reports to fm-fleet)"
    has "$out" "branch:   wave/fleet/1 from feature/fleet (created)   [feature/fleet cut from main]"
    has "$out" "worktree: $wt/wave-fleet-1 (created)"
    has "$out" "claim:    attempt "
    has "$out" "next: cd $wt/wave-fleet-1 && CG_AGENT=w-fleet-1 CG_ROLE=worker CG_PARENT=fm-fleet CG_FEATURE=fleet CG_WAVE=1 cg spec start 2.1"
    branches="$(git branch --list --format='%(refname:short)')"
    has "$branches" "feature/fleet"
    has "$branches" "wave/fleet/1"
    has "$(git worktree list)" "$wt/wave-fleet-1"
    [ -f "$wt/wave-fleet-1/src/a.ts" ] || fail "worktree has no checkout"
    [ "$(git rev-parse feature/fleet)" = "$base_sha" ] || fail "feature branch not at main"
    # main's own checkout is untouched
    [ "$(git rev-parse HEAD)" = "$base_sha" ] || fail "main moved"
    has "$(git branch --show-current)" "main"

    # the worktree binds the shared project on its own branch
    out="$(cd "$wt/wave-fleet-1" && "$CG" root --json)"
    echo "$out" | pyjson '
assert d["worktree"] is True and d["branch"] == "wave/fleet/1", d
assert d["shared"].endswith("/proj") and d["root"].endswith("/wave-fleet-1"), d
' || fail "worktree root JSON"

    # the claim carries the branch, worktree, and parent
    out="$("$CG" spec status)"
    has "$out" "claimed by w-fleet-1 [worker under fm-fleet] on wave/fleet/1"
    out="$("$CG" spec status --json)"
    echo "$out" | pyjson '
c = {x["id"]: x for x in d["claims"]}
assert c["2.1"]["agent"] == "w-fleet-1" and c["2.1"]["branch"] == "wave/fleet/1", c
assert c["2.1"]["worktree"].endswith("/.codegraph/worktrees/wave-fleet-1"), c
assert c["2.1"]["parent"] == "fm-fleet", c
' || fail "claim branch JSON"
    rows="$(python3 - <<'EOF'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
print("|".join(f"{t}:{a}:{b}:{p}:{w.rsplit('/', 1)[-1]}" for t, a, b, p, w in
      db.execute("SELECT task,agent,ifnull(branch,''),ifnull(parent,''),ifnull(worktree,'') "
                 "FROM attempts WHERE state='running' ORDER BY task")))
EOF
)"
    has "$rows" "fleet/2.1:w-fleet-1:wave/fleet/1:fm-fleet:wave-fleet-1"
    out="$("$CG" branches)"
    has "$out" "wave/fleet/1"

    # ---- begin again: everything is reused, the claim renewed
    out="$("$CG" fleet begin 2.1 --json)"
    echo "$out" | pyjson '
assert d["task"] == "2.1" and d["feature"] == "fleet" and d["wave"] == 1, d
assert d["agent"] == "w-fleet-1" and d["role"] == "worker" and d["parent"] == "fm-fleet", d
assert d["branch"] == "wave/fleet/1" and d["base"] == "feature/fleet", d
assert d["branch_created"] is False and d["base_created"] is False, d
assert d["worktree_created"] is False and d["worktree"].endswith("/wave-fleet-1"), d
assert d["attempt"]["fence"] > 0 and d["attempt"]["expires_in_min"] == 30, d
assert d["env"] == {"CG_AGENT": "w-fleet-1", "CG_ROLE": "worker", "CG_PARENT": "fm-fleet",
                    "CG_FEATURE": "fleet", "CG_WAVE": "1"}, d["env"]
' || fail "begin reuse JSON"
    out="$("$CG" fleet begin 2.1)"
    has "$out" "wave/fleet/1 from feature/fleet (reused)"
    hasnt "$out" "cut from main"
    has "$out" "$wt/wave-fleet-1 (reused)"

    # ---- a task another agent holds is not begun; the branch stays
    CG_AGENT=intruder "$CG" spec claim 2.2 >/dev/null
    expect_rc 1 "$CG" fleet begin 2.2
    err="$("$CG" fleet begin 2.2 2>&1 >/dev/null || true)"
    has "$err" "2.2 is already claimed by intruder"
    has "$err" "2.2 was not claimed — wave/fleet/1 and $wt/wave-fleet-1 stay for a retry"
    CG_AGENT=intruder "$CG" spec release 2.2 >/dev/null
    # unknown task, done task, --agent override
    expect_rc 1 "$CG" fleet begin 9.9
    err="$("$CG" fleet begin 9.9 2>&1 >/dev/null || true)"
    has "$err" "no [task.9.9] with a wave"
    expect_rc 1 "$CG" fleet begin 1.1
    err="$("$CG" fleet begin 1.1 2>&1 >/dev/null || true)"
    has "$err" "1.1 is done — nothing to begin"
    out="$("$CG" fleet begin 2.2 --agent w-alt)"
    has "$out" "agent:    w-alt (worker, reports to fm-fleet)"
    has "$out" "wave/fleet/1 from feature/fleet (reused)"
    CG_AGENT=w-alt "$CG" spec release 2.2 >/dev/null

    # ---- the worker implements on its branch and qualifies there
    cd "$wt/wave-fleet-1"
    CG_AGENT=w-fleet-1 CG_ROLE=worker CG_PARENT=fm-fleet "$CG" spec start 2.1 >/dev/null
    echo 'export function alpha(){ return 1 }' > src/a.ts
    git add -A >/dev/null; git commit -qm "alpha: implement" >/dev/null
    cd "$proj"
    # not yet qualified on the branch tip: merge-up refuses
    expect_rc 1 "$CG" fleet merge-up 2.1
    err="$("$CG" fleet merge-up 2.1 2>&1 >/dev/null || true)"
    has "$err" "2.1 is in_progress on wave/fleet/1, not done — qualify it (cg spec done 2.1) and commit, or --force"
    expect_rc 1 "$CG" fleet merge-up 3.1
    err="$("$CG" fleet merge-up 3.1 2>&1 >/dev/null || true)"
    has "$err" "no branch wave/fleet/2 for 3.1 — run cg fleet begin 3.1 first"
    cd "$wt/wave-fleet-1"
    echo 'export function alpha(){ return 2 }' > src/a.ts
    CG_AGENT=w-fleet-1 "$CG" spec done 2.1 >/dev/null
    git add -A >/dev/null; git commit -qm "alpha: qualified [spec:fleet/2.1]" >/dev/null
    cd "$proj"

    # ---- merge-up: wave into feature, in the feature manager's worktree
    out="$("$CG" fleet merge-up 2.1)"
    has "$out" "merged wave/fleet/1 into feature/fleet: 2 commits (head "
    has "$out" ") at $wt/feature-fleet"
    [ -e "$wt/feature-fleet/.git" ] || fail "no feature worktree"
    has "$(cat "$wt/feature-fleet/src/a.ts")" "return 2"
    has "$(git log --oneline feature/fleet)" "merge wave/fleet/1 into feature/fleet [spec:fleet/2.1]"
    has "$(git show feature/fleet:spec/fleet/spec.kvx)" 'status = "done"'
    # main is untouched by a merge-up
    hasnt "$(cat src/a.ts)" "return 2"
    [ "$(git rev-parse HEAD)" = "$base_sha" ] || fail "main moved on merge-up"
    out="$("$CG" fleet merge-up 2.1)"
    has "$out" "nothing to merge: feature/fleet already contains wave/fleet/1"
    out="$("$CG" fleet merge-up 2.1 --json)"
    echo "$out" | pyjson '
assert d["merged"] is False and d["commits"] == 0, d
assert d["branch"] == "wave/fleet/1" and d["base"] == "feature/fleet", d
assert d["worktree"].endswith("/feature-fleet") and len(d["head"]) == 40, d
' || fail "merge-up nothing JSON"
    has "$("$CG" branches)" "feature/fleet"

    # ---- a conflicting wave: paths listed, feature worktree left as it was
    out="$("$CG" fleet begin 3.1)"
    has "$out" "begin 3.1 — wave 2 of fleet"
    has "$out" "branch:   wave/fleet/2 from feature/fleet (created)"
    hasnt "$out" "cut from main"
    cd "$wt/wave-fleet-2"
    has "$(cat src/a.ts)" "return 2"
    CG_AGENT=w-fleet-2 CG_ROLE=worker CG_PARENT=fm-fleet "$CG" spec start 3.1 >/dev/null
    echo '# doc, by the worker' > docs/d.md
    CG_AGENT=w-fleet-2 "$CG" spec done 3.1 >/dev/null
    git add -A >/dev/null; git commit -qm "docs: worker [spec:fleet/3.1]" >/dev/null
    cd "$wt/feature-fleet"
    echo '# doc, by the manager' > docs/d.md
    git add -A >/dev/null; git commit -qm "docs: manager" >/dev/null
    cd "$proj"
    expect_rc 1 "$CG" fleet merge-up 3.1
    out="$("$CG" fleet merge-up 3.1 2>/dev/null || true)"
    has "$out" "cg fleet: wave/fleet/2 does not merge into feature/fleet"
    has "$out" "conflicts in 1 path(s):"
    has "$out" "  docs/d.md"
    has "$out" "merge aborted"
    [ -z "$(git -C "$wt/feature-fleet" status --porcelain)" ] || fail "feature worktree dirty after abort"
    has "$(cat "$wt/feature-fleet/docs/d.md")" "by the manager"
    out="$("$CG" fleet merge-up 3.1 --json 2>/dev/null || true)"
    echo "$out" | pyjson '
assert d["merged"] is False and d["conflicts"] == ["docs/d.md"] and d["kept"] is False, d
' || fail "merge-up conflict JSON"
    # --keep leaves the merge in place for the manager to resolve
    out="$("$CG" fleet merge-up 3.1 --keep 2>/dev/null || true)"
    has "$out" "merge left in place at $wt/feature-fleet — resolve, commit, then cg fleet merge-up 3.1 again"
    has "$(git -C "$wt/feature-fleet" diff --name-only --diff-filter=U)" "docs/d.md"
    git -C "$wt/feature-fleet" merge --abort
    # a dirty feature worktree is refused before any merge
    echo 'dirty' >> "$wt/feature-fleet/lib/b.ts"
    expect_rc 1 "$CG" fleet merge-up 3.1
    err="$("$CG" fleet merge-up 3.1 2>&1 >/dev/null || true)"
    has "$err" "has uncommitted changes on feature/fleet"
    git -C "$wt/feature-fleet" checkout -q -- lib/b.ts

    # ---- land: gates red means main is reset; green lands and prints the PR
    expect_rc 1 "$CG" fleet land fleet
    out="$("$CG" fleet land fleet 2>/dev/null || true)"
    has "$out" "landing refused: test gate \`sh gate.sh\` failed (exit 1) — main reset to ${base_sha:0:8}"
    has "$out" "log: $proj/.codegraph/fleet/land-fleet-test.log"
    [ "$(git rev-parse HEAD)" = "$base_sha" ] || fail "main not reset after red gate"
    [ -z "$(git status --porcelain --untracked-files=no)" ] || fail "main dirty after reset"
    touch gate.ok
    out="$("$CG" fleet land fleet --json 2>/dev/null || true)"
    echo "$out" | pyjson "
assert d['landed'] is False and d['reset_to'] == '$base_sha', d
assert d['gates']['test']['ok'] is True and d['gates']['lint']['ok'] is False, d
assert d['gates']['lint']['exit'] == 1 and d['gates']['lint']['cmd'] == 'sh lint.sh', d
" || fail "land red lint JSON"
    [ "$(git rev-parse HEAD)" = "$base_sha" ] || fail "main not reset after red lint"
    touch lint.ok
    out="$(CG_GH=/nonexistent/gh "$CG" fleet land fleet)"
    has "$out" "landed feature/fleet into main: 4 commits, gates green (head "
    has "$out" "test: \`sh gate.sh\` ok in "
    has "$out" "lint: \`sh lint.sh\` ok in "
    has "$out" "pull request (gh not found): run these to open feature/fleet against origin/main:"
    has "$out" "git -C '$proj' push -u 'origin' 'feature/fleet'"
    has "$out" "'gh' pr create --base 'main' --head 'feature/fleet' --title "
    has "$out" "--body-file '$proj/.codegraph/fleet/pr-fleet.md'"
    has "$(cat src/a.ts)" "return 2"
    has "$(cat docs/d.md)" "by the manager"
    has "$(git log --oneline -1)" "land feature/fleet into main [spec:fleet]"
    has "$(cat .codegraph/fleet/pr-fleet.md)" "## Tasks"
    has "$(cat .codegraph/fleet/pr-fleet.md)" "- 2.1 Alpha work (done)"
    has "$(cat .codegraph/fleet/pr-fleet.md)" "- 3.1 Docs work (pending)"
    landed_sha="$(git rev-parse HEAD)"
    out="$(CG_GH=/nonexistent/gh "$CG" fleet land fleet)"
    has "$out" "nothing to land: main already contains feature/fleet"
    out="$(CG_GH=/nonexistent/gh "$CG" fleet land fleet --json)"
    echo "$out" | pyjson "
assert d['landed'] is False and d['commits'] == 0 and d['head'] == '$landed_sha', d
" || fail "land nothing JSON"
    # --no-pr and a manual policy print no gh commands / print them
    expect_rc 1 "$CG" fleet land nope
    err="$("$CG" fleet land nope 2>&1 >/dev/null || true)"
    has "$err" "no branch feature/nope"

    # ---- pr: pushes and opens through gh; printed when gh is missing
    git init -q --bare "$TMP/remote.git"
    git remote add origin "$TMP/remote.git"
    git push -q origin main
    export GH_FAKE_DIR="$TMP/gh"
    fake_gh="$FIXTURES/fleet/fake-gh.sh"
    out="$(CG_GH=/nonexistent/gh "$CG" fleet pr fleet)"
    has "$out" "pull request (gh not found): run these to open feature/fleet against origin/main:"
    has "$out" "push -u 'origin' 'feature/fleet'"
    out="$(CG_GH=$fake_gh "$CG" fleet pr fleet --dry-run --json)"
    echo "$out" | pyjson "
assert d['opened'] is False and d['reason'] == 'dry-run', d
assert d['branch'] == 'feature/fleet' and d['base'] == 'main' and d['remote'] == 'origin', d
assert len(d['commands']) == 2 and 'pr create' in d['commands'][1], d
" || fail "pr dry-run JSON"
    [ ! -e "$GH_FAKE_DIR/calls.txt" ] || fail "dry run called gh"
    hasnt "$(git -C "$TMP/remote.git" branch --list)" "feature/fleet"
    out="$(CG_GH=$fake_gh "$CG" fleet pr fleet)"
    has "$out" "opened https://github.com/acme/repo/pull/7 (feature/fleet → main)"
    has "$(git -C "$TMP/remote.git" branch --list)" "feature/fleet"
    calls="$(cat "$GH_FAKE_DIR/calls.txt")"
    has "$calls" "pr list --head feature/fleet --base main --state open --json number,url"
    has "$calls" "pr create --base main --head feature/fleet --title "
    has "$calls" "--body-file $proj/.codegraph/fleet/pr-fleet.md"
    out="$(CG_GH=$fake_gh "$CG" fleet pr fleet --json)"
    echo "$out" | pyjson "
assert d['opened'] is True and d['url'] == 'https://github.com/acme/repo/pull/7', d
assert d['pushed'] is True and d['branch'] == 'feature/fleet', d
" || fail "pr open JSON"
    # an already-open PR is reported, not duplicated
    cat > "$GH_FAKE_DIR/prs.json" <<'EOF'
[{"number": 7, "headRefName": "feature/fleet", "title": "Fleet", "url": "https://github.com/acme/repo/pull/7"}]
EOF
    : > "$GH_FAKE_DIR/calls.txt"
    out="$(CG_GH=$fake_gh "$CG" fleet pr fleet)"
    has "$out" "already open: #7 https://github.com/acme/repo/pull/7 (feature/fleet → main)"
    hasnt "$(cat "$GH_FAKE_DIR/calls.txt")" "pr create"
    out="$(CG_GH=$fake_gh "$CG" fleet pr fleet --json)"
    echo "$out" | pyjson "assert d['opened'] is False and d['already_open'] is True and d['number'] == 7, d" \
        || fail "pr already-open JSON"
    # land with pr=auto and gh present opens it in the same call
    cd "$wt/feature-fleet"
    echo 'export function beta(){ return 3 }' > lib/b.ts
    git add -A >/dev/null; git commit -qm "beta" >/dev/null
    cd "$proj"
    rm "$GH_FAKE_DIR/prs.json"
    : > "$GH_FAKE_DIR/calls.txt"
    out="$(CG_GH=$fake_gh "$CG" fleet land fleet --json)"
    echo "$out" | pyjson "
assert d['landed'] is True and d['commits'] == 1 and d['gates']['lint']['ok'] is True, d
assert d['pr']['opened'] is True and d['pr']['url'].endswith('/pull/7'), d
" || fail "land + pr JSON"
    has "$(cat "$GH_FAKE_DIR/calls.txt")" "pr create"
    # --no-pr lands without touching gh
    cd "$wt/feature-fleet"
    echo 'export function beta(){ return 4 }' > lib/b.ts
    git add -A >/dev/null; git commit -qm "beta again" >/dev/null
    cd "$proj"
    : > "$GH_FAKE_DIR/calls.txt"
    out="$(CG_GH=$fake_gh "$CG" fleet land fleet --no-pr)"
    has "$out" "landed feature/fleet into main: 1 commit, gates green"
    hasnt "$out" "pull request"
    [ ! -s "$GH_FAKE_DIR/calls.txt" ] || fail "--no-pr called gh"
    out="$(CG_GH=$fake_gh "$CG" fleet land fleet --no-pr --json)"
    echo "$out" | pyjson "assert d['landed'] is False and d['commits'] == 0, d" || fail "no-pr JSON"

    # ---- checkpoint: open feature PRs merge lowest number first, others skip
    cat > "$GH_FAKE_DIR/prs.json" <<'EOF'
[{"number": 9, "headRefName": "feature/other", "title": "Other", "url": "https://github.com/acme/repo/pull/9"},
 {"number": 7, "headRefName": "feature/fleet", "title": "Fleet", "url": "https://github.com/acme/repo/pull/7"},
 {"number": 8, "headRefName": "hotfix/x", "title": "Hotfix", "url": "https://github.com/acme/repo/pull/8"}]
EOF
    : > "$GH_FAKE_DIR/calls.txt"
    out="$(CG_GH=$fake_gh "$CG" fleet checkpoint)"
    has "$out" "merged #7 feature/fleet — Fleet (https://github.com/acme/repo/pull/7)"
    has "$out" "merged #9 feature/other — Other (https://github.com/acme/repo/pull/9)"
    has "$out" "skipped #8 hotfix/x — not a feature/* branch"
    has "$out" "checkpoint: 2 merged, 1 skipped"
    has "$out" "local main: fast-forwarded to "
    calls="$(cat "$GH_FAKE_DIR/calls.txt")"
    has "$calls" "pr list --base main --state open --json number,headRefName,title,url"
    python3 - "$GH_FAKE_DIR/calls.txt" <<'EOF' || fail "checkpoint merge order"
import sys
lines = open(sys.argv[1]).read().splitlines()
merges = [l for l in lines if l.startswith("pr merge")]
assert merges == ["pr merge 7 --merge", "pr merge 9 --merge"], merges
EOF
    # a merge that fails stops the checkpoint there
    echo 9 > "$GH_FAKE_DIR/fail-merge"
    : > "$GH_FAKE_DIR/calls.txt"
    expect_rc 1 env CG_GH="$fake_gh" "$CG" fleet checkpoint
    out="$(CG_GH=$fake_gh "$CG" fleet checkpoint 2>/dev/null || true)"
    has "$out" "merged #7 feature/fleet"
    has "$out" "could not merge #9 feature/other — X Pull request #9 is not mergeable"
    has "$out" "checkpoint: 1 merged, 1 skipped"
    out="$(CG_GH=$fake_gh "$CG" fleet checkpoint --json 2>/dev/null || true)"
    echo "$out" | pyjson "
m = d['merged']
assert [x['number'] for x in m] == [7, 9] and m[0]['ok'] is True and m[1]['ok'] is False, m
assert 'not mergeable' in m[1]['error'], m
assert [x['number'] for x in d['skipped']] == [8] and d['remaining'] == 0, d
assert d['local_main']['updated'] is True and len(d['local_main']['head']) == 40, d
" || fail "checkpoint JSON"
    rm "$GH_FAKE_DIR/fail-merge"
    # without gh, or dry, the commands are printed and nothing runs
    : > "$GH_FAKE_DIR/calls.txt"
    out="$(CG_GH=/nonexistent/gh "$CG" fleet checkpoint)"
    has "$out" "checkpoint (gh not found): merge the open feature/* pull requests lowest number first:"
    has "$out" "gh pr list --base 'main' --state open --json number,headRefName,title,url"
    has "$out" "gh pr merge <number> --merge"
    out="$(CG_GH=$fake_gh "$CG" fleet checkpoint --dry-run --json)"
    echo "$out" | pyjson "assert d['merged'] == [] and d['reason'] == 'dry-run' and d['prefix'] == 'feature/', d" \
        || fail "checkpoint dry JSON"
    [ ! -s "$GH_FAKE_DIR/calls.txt" ] || fail "dry checkpoint called gh"
    # nothing open
    echo '[]' > "$GH_FAKE_DIR/prs.json"
    out="$(CG_GH=$fake_gh "$CG" fleet checkpoint)"
    has "$out" "checkpoint: 0 merged, 0 skipped — no open pull requests"
    unset GH_FAKE_DIR

    # ---- usage
    expect_rc 1 "$CG" fleet begin
    expect_rc 1 "$CG" fleet merge-up
fi

echo "ok 26_fleet ($section)"
