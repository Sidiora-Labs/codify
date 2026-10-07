#!/usr/bin/env bash
# cg help — one command table (src/help.c) behind the overview, per-command
# detail, --all, --json, and the usage lines on bad arguments. The table is
# checked against the dispatchers themselves (main.c and every subcommand
# switch) and against the README's command reference, so a command added in
# one place and not the others fails here.
. "$(dirname "$0")/../lib.sh"

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
export HOME="$TMP/home"
mkdir -p "$HOME"
unset CG_COLOR NO_COLOR COLUMNS

# ---- the overview: cg help, cg -h, cg --help exit 0; bare cg exits 1
out="$("$CG" help)"
has "$out" "Codify "
has "$out" "usage: cg <command> [args]"
for g in "graph" "version control" "memory" "agentic" "spec workflow" \
         "fleet" "jev" "skills" "configuration" "global flags"; do
    has "$out" "
$g"
done
for f in --json "--branch <name>" --all-branches --no-soft "cg help <command>"; do
    has "$out" "$f"
done
[ "$("$CG" -h)" = "$out" ] || fail "cg -h differs from cg help"
[ "$("$CG" --help)" = "$out" ] || fail "cg --help differs from cg help"
rc=0; bare="$("$CG" 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "bare cg should exit 1, got $rc"
[ "$bare" = "$out" ] || fail "bare cg should print the overview"

# ---- no escape codes into a pipe; CG_COLOR=0/1 decide; NO_COLOR wins on a tty
esc=$'\033['
hasnt "$out" "$esc"
hasnt "$("$CG" help --all)" "$esc"
hasnt "$("$CG" help search)" "$esc"
has "$(CG_COLOR=1 "$CG" help)" "${esc}1m"
has "$(CG_COLOR=1 "$CG" help)" "${esc}2m"
hasnt "$(CG_COLOR=0 "$CG" help)" "$esc"
if command -v script >/dev/null 2>&1 &&
   script -qc true /dev/null >/dev/null 2>&1; then
    tty_out="$(TERM=xterm script -qc "$CG help" /dev/null)"
    has "$tty_out" "${esc}1m"
    tty_out="$(TERM=xterm NO_COLOR=1 script -qc "$CG help" /dev/null)"
    hasnt "$tty_out" "$esc"
    tty_out="$(TERM=dumb script -qc "$CG help" /dev/null)"
    hasnt "$tty_out" "$esc"
fi

# ---- width: COLUMNS bounds every line; below 60 the floor is 60
maxw() { python3 -c 'import sys; print(max(len(l) for l in sys.stdin.read().split("\n")))'; }
[ "$(COLUMNS=70 "$CG" help | maxw)" -le 70 ] || fail "overview wider than 70"
[ "$(COLUMNS=70 "$CG" help --all | maxw)" -le 70 ] || fail "--all wider than 70"
[ "$(COLUMNS=70 "$CG" help spec | maxw)" -le 70 ] || fail "spec detail wider than 70"
[ "$(COLUMNS=20 "$CG" help --all | maxw)" -le 60 ] || fail "below the 60 floor"
[ "$("$CG" help | maxw)" -le 80 ] || fail "default overview wider than 80"
w="$(COLUMNS=200 "$CG" help spec | maxw)"
[ "$w" -gt 80 ] || fail "COLUMNS=200 should let the spec usage line run long"

# ---- per-command detail: cg help <name>, cg <name> --help, -h agree
d="$("$CG" help sync)"
has "$d" "usage: cg sync"
has "$d" "--workers N"
has "$d" "flags"
has "$d" "related"
[ "$("$CG" sync --help)" = "$d" ] || fail "cg sync --help differs"
[ "$("$CG" sync -h)" = "$d" ] || fail "cg sync -h differs"
has "$("$CG" help index)" "--workers N"
d="$("$CG" help spec next)"
has "$d" "usage: cg spec next"
[ "$("$CG" spec next -h)" = "$d" ] || fail "cg spec next -h differs"
[ "$("$CG" help "spec next")" = "$d" ] || fail "quoted name differs"
d="$("$CG" help spec)"
has "$d" "subcommands"
has "$d" "claim-next"
has "$d" "heartbeat"
has "$d" "examples"
d="$(COLUMNS=200 "$CG" help journal)"
has "$d" "writes queued while the database was busy: list, apply, drop"
has "$d" "drop <id>|--failed|--all"
has "$("$CG" help --all)" "usage: cg fleet steer <agent> <message>"

# ---- an unknown name suggests the closest and exits 1
rc=0; err="$("$CG" help sepc 2>&1 >/dev/null)" || rc=$?
[ "$rc" -eq 1 ] || fail "unknown help name should exit 1, got $rc"
has "$err" "no command named 'sepc'"
has "$err" "cg spec"
rc=0; err="$("$CG" serch 2>&1 >/dev/null)" || rc=$?
[ "$rc" -eq 1 ] || fail "unknown command should exit 1"
has "$err" "did you mean: cg search"
rc=0; "$CG" nosuchthing --help >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 1 ] || fail "unknown cg X --help should exit 1"

# ---- the table covers every dispatched command and subcommand; every name
#      answers cg help <name> and cg <name> --help with exit 0; the README's
#      command reference names the same commands
"$CG" help --json > "$TMP/help.json"
python3 - "$REPO" "$TMP/help.json" "$CG" <<'PY'
import json, os, re, subprocess, sys
repo, path, cg = sys.argv[1:4]
d = json.load(open(path))
names = {c["name"] for c in d["commands"]}
known = set(names)
for c in d["commands"]:
    known.update(c["aliases"])
    for k in ("name", "group", "usage", "summary", "flags", "related"):
        assert k in c, (c["name"], k)
    assert c["usage"].startswith("cg "), c["name"]
    assert c["summary"], c["name"]
    for r in c["related"]:
        assert r in names, f"{c['name']}: related {r} is not a command"
groups = [g["title"] for g in d["groups"]]
assert groups == ["graph", "version control", "memory", "agentic",
                  "spec workflow", "fleet", "jev", "skills",
                  "configuration"], groups
assert {f["flag"] for f in d["global_flags"]} >= {"--json", "--branch <name>",
                                                  "--all-branches", "--no-soft"}

src = os.path.join(repo, "src")
def read(f):
    p = os.path.join(src, f)
    return open(p).read() if os.path.exists(p) else None

# main.c: every strcmp(cmd, "X"), and the argv[2] words under each
main = read("main.c")
want = set()
cur = None
for line in main.split("\n"):
    for m in re.finditer(r'strcmp\(cmd, "([^"]+)"\)', line):
        cur = m.group(1)
        if not cur.startswith("-"):
            want.add(cur)
    for m in re.finditer(r'strcmp\(argv\[2\], "([a-z-]+)"\)', line):
        want.add(f"{cur} {m.group(1)}")
want.add("help")
# the subcommand switches, file -> (parent, the variable they switch on)
subs = [("spec.c", "spec", "sub"), ("fleet.c", "fleet", "sub"),
        ("jev.c", "jev", "sub"), ("config.c", "config", "sub"),
        ("docs.c", "docs", "sub"), ("drift.c", "drift", "sub"),
        ("runtime.c", "event", "sub"), ("govern.c", "work", "sub"),
        ("skills.c", "skills", "sub"), ("mcp.c", "tool", r"argv\[0\]"),
        ("integrate.c", "integrate", "action"),
        ("journal.c", "journal", "sub")]
for f, parent, var in subs:
    s = read(f)
    if s is None:
        assert f == "journal.c", f"missing {f}"
        continue
    found = set(re.findall(r'strcmp\(' + var + r', "([a-z-]+)"\)', s))
    assert found or f == "journal.c", f"no subcommands found in {f}"
    if f == "integrate.c":
        found &= {"detect", "plan", "apply", "doctor"}
    want.update(f"{parent} {w}" for w in found)
missing = sorted(w for w in want if w not in known)
assert not missing, f"dispatched but not in cg help --json: {missing}"

# every row answers cg help <name> and cg <name> --help
for n in sorted(names):
    for argv in ([cg, "help"] + n.split(), [cg] + n.split() + ["--help"]):
        r = subprocess.run(argv, capture_output=True, text=True)
        assert r.returncode == 0, (argv, r.returncode, r.stderr)
        assert "usage: cg " in r.stdout, argv

# README: the first cell of each command-table row names commands
readme = open(os.path.join(repo, "README.md")).read()
named = set()
tops = {n for n in names if " " not in n}
for line in readme.split("\n"):
    if not line.startswith("| `cg "):
        continue
    cell = re.split(r"(?<!\\)\|", line)[1]
    spans = re.findall(r"`cg ([^`]*)`", cell)
    for sp in spans:
        top = sp.split()[0]
        assert top in tops, f"README names unknown command cg {top}: {line[:60]}"
        named.add(top)
    top = spans[0].split()[0]
    for w in re.findall(r"(?<![-\w<.])([a-z][a-z-]*)", cell.replace("\\", "")):
        if f"{top} {w}" in known:
            c = next((x for x in d["commands"] if x["name"] == f"{top} {w}"
                      or f"{top} {w}" in x["aliases"]), None)
            named.add(c["name"])
absent = sorted(n for n in names if n not in named)
assert not absent, f"in cg help but not in the README command reference: {absent}"
print(f"{len(names)} commands covered")
PY

# ---- a bad argument prints the same usage line the table holds
usage_of() {
    python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))
print(next(c["usage"] for c in d["commands"] if c["name"]==sys.argv[2]))' \
        "$TMP/help.json" "$1"
}
agree() {   # agree <table name> <cg args...>
    local name="$1" err
    shift
    err="$("$CG" "$@" 2>&1 >/dev/null || true)"
    local line
    line="$(printf '%s\n' "$err" | grep -m1 '^usage: ' || true)"
    [ "$line" = "usage: $(usage_of "$name")" ] ||
        fail "cg $* printed '$line', table says 'usage: $(usage_of "$name")'"
}
agree "spec" spec bogus
agree "spec new" spec new
agree "spec mode" spec mode
agree "spec run" spec run --bogus
agree "config" config bogus
agree "jev" jev bogus

mkdir -p "$TMP/proj/src"
printf 'int main(void) { return 0; }\n' > "$TMP/proj/src/a.c"
cd "$TMP/proj"
"$CG" init >/dev/null
agree "search" search
agree "symbol" symbol
agree "impact" impact
agree "context" context
agree "show" show
agree "why" why
agree "checkout" checkout
agree "commit" commit
agree "remember" remember
agree "forget" forget
agree "hook" hook bogus
agree "memory" memory bogus
agree "memory classify" memory classify x
agree "memory import" memory import
agree "events" events --bogus
agree "event" event bogus
agree "work" work bogus
agree "drift" drift bogus
agree "drift check" drift check
agree "docs" docs bogus
agree "skills" skills bogus
agree "skills promote" skills promote
agree "tool" tool bogus
agree "integrate" integrate bogus
agree "fleet" fleet bogus
agree "fleet begin" fleet begin
agree "fleet merge-up" fleet merge-up
agree "fleet approve" fleet approve
agree "fleet steer" fleet steer

echo "43_help: ok"
