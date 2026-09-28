#!/usr/bin/env bash
# serve: one JSON-RPC connection for editors (cg serve) and cg tool.
#   tool      — cg tool list/call run the MCP table without a client
#   rpc       — initialize, tools/list matches cg mcp, tools/call, exec,
#               errors, and replies still arrive after the client closes
#   events    — subscribe pushes events within 250 ms of their commit,
#               with kind filters, backlog from a cursor, and unsubscribe
#   async     — a long call does not hold up pushes; cancel stops it
#   idle      — an idle server holds neither the write lock nor the gate
# Run one section: 31_serve.sh events
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

setup_repo() {
    rm -rf "$TMP/proj"
    mkdir -p "$TMP/proj/src"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || git init -q .
    echo 'export function alpha(){ return beta() }' > src/a.ts
    echo 'export function beta(){ return 1 }' > src/b.ts
    "$CG" spec new demo >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha" --wave 1 --touches 'src/a.ts' >/dev/null
    "$CG" spec add 2.2 --title "Beta" --wave 1 --touches 'src/b.ts' >/dev/null
    "$CG" init >/dev/null
}

# The client: a small python driver over the server's stdio, shared by the
# sections below. Reads the script to run from stdin.
client() {
    python3 - "$CG" "$@" <<'PY'
import json, os, subprocess, sys, threading, time, queue
CG = sys.argv[1]

class Serve:
    def __init__(self):
        self.p = subprocess.Popen([CG, "serve"], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=True, bufsize=1)
        self.q = queue.Queue()
        self.replies = {}
        self.notes = []
        self.lock = threading.Lock()
        self.cv = threading.Condition(self.lock)
        self.n = 0
        threading.Thread(target=self._read, daemon=True).start()
    def _read(self):
        for line in self.p.stdout:
            m = json.loads(line)
            with self.cv:
                if "id" in m: self.replies[m["id"]] = (m, time.time())
                else: self.notes.append((m, time.time()))
                self.cv.notify_all()
    def send(self, method, params=None):
        self.n += 1
        msg = {"jsonrpc": "2.0", "id": self.n, "method": method}
        if params is not None: msg["params"] = params
        self.p.stdin.write(json.dumps(msg) + "\n"); self.p.stdin.flush()
        return self.n
    def wait(self, rid, timeout=30):
        end = time.time() + timeout
        with self.cv:
            while rid not in self.replies:
                left = end - time.time()
                assert left > 0, f"no reply to {rid}"
                self.cv.wait(left)
            return self.replies[rid][0]
    def call(self, method, params=None, timeout=30):
        return self.wait(self.send(method, params), timeout)
    def events(self, pred, timeout=5):
        """first pushed event matching pred, and when it arrived"""
        end = time.time() + timeout
        with self.cv:
            while True:
                for m, t in self.notes:
                    if m.get("method") != "events": continue
                    for e in m["params"]["events"]:
                        if pred(e, m["params"]["subscription"]): return e, t
                left = end - time.time()
                if left <= 0: return None, None
                self.cv.wait(left)
    def close(self):
        self.p.stdin.close(); self.p.wait(10)

def cg(*a):
    return subprocess.run([CG, *a], capture_output=True, text=True)

exec(sys.stdin.read())
PY
}

if want tool; then
    setup_repo
    out="$("$CG" tool list)"
    has "$out" "search_code"
    has "$out" "spec_status"
    n_list="$("$CG" tool list --json | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["tools"]))')"
    n_mcp="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | "$CG" mcp | python3 -c 'import json,sys; print(len(json.loads(sys.stdin.readline())["result"]["tools"]))')"
    [ "$n_list" = "$n_mcp" ] && [ "$n_list" -gt 40 ] || fail "tool list $n_list vs mcp $n_mcp"
    out="$("$CG" tool call spec_status)"
    echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["feature"]=="demo", d' \
        || fail "tool call spec_status"
    out="$("$CG" tool call search_code '{"query":"alpha"}')"
    has "$out" "alpha"
    out="$(echo '{"name":"beta"}' | "$CG" tool call get_symbol -)"
    has "$out" "beta"
    expect_rc 2 "$CG" tool call no_such_tool
    err="$("$CG" tool call no_such_tool 2>&1 || true)"
    has "$err" "unknown tool 'no_such_tool'"
    expect_rc 2 "$CG" tool call spec_status 'not json'
    expect_rc 2 "$CG" tool bogus
fi

if want rpc; then
    setup_repo
    client <<'PY' || fail "rpc"
s = Serve()
r = s.call("initialize")["result"]
assert r["protocol"] == "codify-serve/1", r
assert r["root"].endswith("/proj") and r["branch"] and isinstance(r["head"], int), r
assert r["capabilities"]["events"] and r["capabilities"]["exec"] and r["capabilities"]["cancel"], r
tools = s.call("tools/list")["result"]["tools"]
mcp = subprocess.run([CG, "mcp"], input='{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
                     capture_output=True, text=True).stdout
assert [t["name"] for t in tools] == [t["name"] for t in json.loads(mcp)["result"]["tools"]]
st = s.call("tools/call", {"name": "spec_status"})["result"]
assert st["isError"] is False and st["exit"] == 0, st
assert json.loads(st["content"][0]["text"])["feature"] == "demo", st
sr = s.call("tools/call", {"name": "search_code", "arguments": {"query": "beta"}})["result"]
assert "beta" in sr["content"][0]["text"], sr
bad = s.call("tools/call", {"name": "no_such_tool"})
assert bad["error"]["code"] == -32602, bad
ex = s.call("exec", {"args": ["spec", "status", "--json"]})["result"]
assert ex["exit"] == 0 and json.loads(ex["stdout"])["feature"] == "demo", ex
fail_ex = s.call("exec", {"args": ["search"]})["result"]
assert fail_ex["exit"] != 0 and "usage" in fail_ex["stderr"], fail_ex
assert s.call("exec", {"args": []})["error"]["code"] == -32602
assert s.call("exec", {"args": ["spec", 3]})["error"]["code"] == -32602
assert s.call("nope")["error"]["code"] == -32601
assert s.call("ping")["result"] == {}
# an in-flight reply still arrives after the client closes its side
rid = s.send("exec", {"args": ["events", "--follow", "--for", "0.5", "--head"]})
s.p.stdin.close()
m = s.wait(rid, 10)
assert m["result"]["exit"] == 0, m
assert s.p.wait(10) == 0
PY
    # shutdown ends the session at once
    out="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"shutdown"}' \
                         '{"jsonrpc":"2.0","id":2,"method":"ping"}' | "$CG" serve)"
    has "$out" '"id":1,"result":{}'
    hasnt "$out" '"id":2'
fi

if want events; then
    setup_repo
    client <<'PY' || fail "events"
s = Serve()
head = s.call("initialize")["result"]["head"]
sub = s.call("subscribe")["result"]
assert sub["cursor"] == head and sub["subscription"] >= 1, sub
claims = s.call("subscribe", {"kinds": "claim"})["result"]["subscription"]

# latency: from the committing command's exit to the pushed event
lat = []
for i, task in enumerate(["2.1", "2.2", "2.1", "2.2", "2.1"]):
    agent = f"w{i}"
    r = cg("spec", "claim", task, "--agent", agent)
    t0 = time.time()
    assert r.returncode == 0, r.stderr
    e, t = s.events(lambda e, sid: e["kind"] == "claim" and e["node"] == agent and sid == sub["subscription"])
    assert e, f"claim by {agent} never pushed"
    lat.append(t - t0)
    assert cg("spec", "release", task, "--agent", agent).returncode == 0
lat.sort()
assert lat[len(lat) // 2] <= 0.25 and lat[-1] < 1.0, lat

# the filtered subscription saw claims and nothing else
got = [e for m, _ in s.notes if m["params"]["subscription"] == claims
         for e in m["params"]["events"]]
assert got and all(e["kind"] == "claim" for e in got), got
assert len(got) == 5, len(got)

# a status write reaches the unfiltered subscriber with its transition
assert cg("spec", "start", "2.1").returncode == 0
e, _ = s.events(lambda e, sid: e["kind"] == "task.status" and e["payload"]["status"] == "in_progress")
assert e and e["payload"]["from"] == "pending" and e["subject"] == "demo/2.1", e

# a second subscription from an old cursor replays the backlog in order
old = s.call("subscribe", {"since": head})["result"]["subscription"]
e, _ = s.events(lambda e, sid: sid == old and e["kind"] == "claim")
assert e, "backlog not replayed"
seqs = [x["seq"] for m, _ in s.notes if m["params"]["subscription"] == old
                 for x in m["params"]["events"]]
assert seqs == sorted(seqs) and seqs[0] > head, seqs

# unsubscribe: no more pushes for that subscription
assert s.call("unsubscribe", {"subscription": claims})["result"]["unsubscribed"] is True
before = len([1 for m, _ in s.notes if m["params"]["subscription"] == claims])
assert cg("spec", "claim", "2.2", "--agent", "late").returncode == 0
e, _ = s.events(lambda e, sid: e["node"] == "late" and sid == sub["subscription"])
assert e
time.sleep(0.2)
after = len([1 for m, _ in s.notes if m["params"]["subscription"] == claims])
assert before == after, (before, after)
assert s.call("unsubscribe", {"subscription": 999})["result"]["unsubscribed"] is False
s.close()
PY
fi

if want async; then
    setup_repo
    client <<'PY' || fail "async"
s = Serve()
s.call("initialize")
sub = s.call("subscribe")["result"]["subscription"]
# a call that runs for seconds...
long_id = s.send("exec", {"args": ["events", "--follow", "--for", "20"]})
time.sleep(0.3)
# ...does not hold up a push, nor a second call
r = cg("spec", "claim", "2.1", "--agent", "during")
t0 = time.time()
e, t = s.events(lambda e, sid: e["kind"] == "claim" and e["node"] == "during")
assert e and t - t0 < 1.0, (e, t and t - t0)
quick = s.call("exec", {"args": ["events", "--head"]}, timeout=5)["result"]
assert quick["exit"] == 0
assert long_id not in s.replies
# cancel stops it, and the reply says so
t0 = time.time()
c = s.call("cancel", {"id": long_id})["result"]
assert c["cancelled"] is True, c
m = s.wait(long_id, 5)
assert m["result"]["cancelled"] is True and time.time() - t0 < 3, m
assert s.call("cancel", {"id": 12345})["result"]["cancelled"] is False
s.close()
PY
fi

if want idle; then
    setup_repo
    client <<'PY' || fail "idle"
import fcntl, sqlite3
s = Serve()
s.call("initialize")
s.call("subscribe")
s.call("tools/call", {"name": "search_code", "arguments": {"query": "alpha"}})
time.sleep(1.5)       # past a safety re-check
# nobody else can take the write lock or the index gate while one is held
db = sqlite3.connect(".codegraph/graph.db", timeout=0, isolation_level=None)
db.execute("BEGIN IMMEDIATE"); db.execute("ROLLBACK")
fd = os.open(".codegraph/index.lock", os.O_CREAT | os.O_RDWR)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)
# and it did not index while idle: last_index_at stands still
def last():
    return dict(db.execute("SELECT key, value FROM meta WHERE key LIKE 'last_index_at%'").fetchall())
a = last(); time.sleep(1.2); b = last()
assert a == b, (a, b)
s.close()
PY
fi

echo "serve OK"
