#!/usr/bin/env python3
"""Drive the linked 12.3 process_tree.observe action as root against a real
12.2-shaped launch ledger, root-owned slot lock, broker spools and processes
running under a dedicated slot UID. Bounded component evidence only: no
frontier dispatch, provider, connector or campaign qualification."""
import ctypes, json, os, pathlib, secrets, signal, socket, sqlite3, struct, subprocess, sys, tempfile, threading, time
ROOT = pathlib.Path(__file__).resolve().parents[4]
NATIVE = ROOT / "build/hyperfide-native"
UID = 62123
# The slot UID cannot traverse per-user interpreter installs under /root.
AGENT_PYTHON = "/usr/bin/python3" if os.access("/usr/bin/python3", os.X_OK) else sys.executable
FAILED = []

def emit(assertion, expected, actual):
    print(json.dumps({"type": "assertion", "id": assertion, "expected": expected, "actual": actual}, sort_keys=True), flush=True)
    if expected != actual:
        FAILED.append(assertion)

HELPER = r'''
#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <linux/sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>
static void drop(uid_t uid){if(setgroups(0,NULL)||setgid(uid)||setuid(uid))_exit(125);}
int main(int argc,char **argv){
 if(argc!=4)return 2;
 long target=atol(argv[2]);uid_t uid=(uid_t)atol(argv[3]);
 if(!strcmp(argv[1],"swarm")){
  /* Root may raise the per-UID task limit; the overflow fixture needs more than 1024 slot processes. */
  struct rlimit room={(rlim_t)target+64,(rlim_t)target+64};if(setrlimit(RLIMIT_NPROC,&room)){printf("F %d\n",errno);return 3;}
  drop(uid);for(long k=0;k<target;++k){pid_t c=fork();if(c<0){printf("F %d\n",errno);fflush(stdout);return 3;}if(!c){close(1);for(;;)pause();}}
  printf("R %ld\n",(long)getpid());fflush(stdout);for(;;)pause();
 }
 pid_t child;
 if(target>0){pid_t tid=(pid_t)target;struct clone_args args;memset(&args,0,sizeof args);args.exit_signal=SIGCHLD;args.set_tid=(uint64_t)(uintptr_t)&tid;args.set_tid_size=1;child=(pid_t)syscall(SYS_clone3,&args,sizeof args);}
 else child=fork();
 if(child<0){printf("F %d\n",errno);fflush(stdout);return 4;}
 if(!child){drop(uid);for(;;)pause();}
 printf("R %ld\n",(long)child);fflush(stdout);int status;while(waitpid(child,&status,0)<0&&errno==EINTR){}return 0;
}
'''

CANCEL = r'''
#define _GNU_SOURCE
#include "components.h"
#include "supervisor.h"
#include <stdlib.h>
int main(void){
 static char request[1<<20];size_t n=fread(request,1,sizeof request-1,stdin);request[n]=0;HfRunnerBinding b;
 if(!hf_runner_binding(request,&b)){puts("{\"binding\":false}");return 1;}
 int remaining=-1,done=hf_process_tree_cancel(&b,50,&remaining);
 printf("{\"binding\":true,\"cancelled\":%s,\"remaining\":%d}\n",done?"true":"false",remaining);return done?0:1;
}
'''

AGENT = r'''
import json,os,resource,signal,sys,time
signal.signal(signal.SIGCHLD,signal.SIG_IGN)
reply=os.fdopen(int(sys.argv[1]),"w",buffering=1)
def idle():
    while True: signal.pause()
for line in sys.stdin:
    op=json.loads(line);kind=op["op"];result={}
    if kind=="emit":
        stream=sys.stderr if op.get("stderr") else sys.stdout
        for text in op["lines"]: stream.write(text+"\n")
        stream.flush()
    elif kind=="tree":
        r,w=os.pipe();child=os.fork()
        if child==0:
            os.close(r);grand=os.fork()
            if grand==0: idle()
            os.write(w,str(grand).encode());os.close(w);idle()
        os.close(w);result={"child":child,"grandchild":int(os.read(r,32))};os.close(r)
    elif kind=="double_fork":
        r,w=os.pipe();middle=os.fork()
        if middle==0:
            os.close(r);os.setsid();orphan=os.fork()
            if orphan==0: idle()
            os.write(w,str(orphan).encode());os._exit(0)
        os.close(w);result={"orphan":int(os.read(r,32))};os.close(r)
    elif kind=="hog":
        child=os.fork()
        if child==0:
            chunks=[]
            for _ in range(512): chunks.append(bytearray(1024*1024))
            idle()
        result={"hog":child}
    elif kind=="nproc":
        resource.setrlimit(resource.RLIMIT_NPROC,(op["limit"],op["limit"]));spawned=0;refused=False
        for _ in range(64):
            try: child=os.fork()
            except BlockingIOError: refused=True;break
            if child==0: idle()
            spawned+=1
        result={"spawned":spawned,"refused":refused}
    reply.write(json.dumps(result)+"\n")
'''

def start_time(pid):
    with open(f"/proc/{pid}/stat") as f:
        return f.read().rsplit(")", 1)[1].split()[19]

def session_of(pid):
    try:
        return int(pathlib.Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[3])
    except OSError:
        return None

def boot_id():
    return pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()

def slot_pids():
    found = []
    for entry in os.listdir("/proc"):
        if entry.isdigit():
            try:
                status = pathlib.Path(f"/proc/{entry}/status").read_text()
            except OSError:
                continue
            uid = next((line.split()[2] for line in status.splitlines() if line.startswith("Uid:")), None)
            state = next((line.split()[1] for line in status.splitlines() if line.startswith("State:")), "")
            if uid == str(UID) and state not in ("Z", "X"):
                found.append(int(entry))
    return found

def reap_orphans():
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if not pid:
            return

def kill_slot():
    for _ in range(100):
        pids = slot_pids()
        if not pids:
            return True
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        reap_orphans()
        time.sleep(0.05)
    return not slot_pids()

def wait_gone(pid, seconds=10):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            state = pathlib.Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0]
        except OSError:
            return True
        if state in ("Z", "X"):
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass
        time.sleep(0.02)
    return False

class Fixture:
    def __init__(self, work):
        self.work = work
        self.state = work / "state"
        self.state.mkdir(mode=0o700)
        os.chmod(self.state, 0o700)
        self.launch = "6c3f0a52-1d2e-4f8a-9b3c-" + secrets.token_hex(6)
        self.identity = {"attempt_id": "1b6f2a1e-6c39-4c55-8f2e-0d6a5c0e1a01", "attempt_generation": "3",
                         "sandbox_id": "2c7e3b2f-7d4a-4d66-9a3f-1e7b6d1f2b02", "boot_id": "3d8f4c30-8e5b-4e77-ab40-2f8c7e203c03", "boot_generation": "2"}
        self.helpers, self.agent, self.cgroup, self.lock_created, self.run_created, self.broker = [], None, None, False, False, None
        self.out_path, self.err_path = self.state / f"{self.launch}.stdout", self.state / f"{self.launch}.stderr"

    def request(self, **extra):
        body = {"state_dir": str(self.state), "launch_id": self.launch, **self.identity}
        body.update(extra)
        return body

    def observe(self, **extra):
        return self.raw(self.request(**extra))

    def raw(self, body):
        done = subprocess.run([str(NATIVE), "--component", "12.3", "--action", "process_tree.observe"], input=json.dumps(body),
                              text=True, capture_output=True, timeout=60)
        if done.returncode == 0:
            reply = json.loads(done.stdout)
            return reply["result"] if reply.get("ok") is True else None
        codes = [line.split(": ", 1)[1] for line in done.stderr.splitlines() if line.startswith("hyperfide native: ")]
        return {"refused": True, "exit_nonzero": True, "code": codes[-1] if codes else None, "ok": json.loads(done.stdout or "{}").get("ok")}

    def write_lock(self, owner):
        path = pathlib.Path(f"/run/hyperfide/slot-{UID}.lock")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        os.write(fd, owner.encode())
        os.close(fd)

    def setup(self):
        if slot_pids():
            raise RuntimeError("dedicated slot uid already has processes")
        run = pathlib.Path("/run/hyperfide")
        if not run.exists():
            run.mkdir(mode=0o700)
            self.run_created = True
        lock = run / f"slot-{UID}.lock"
        if lock.exists():
            raise RuntimeError("slot lock already exists for the fixture uid")
        self.lock_created = True
        self.write_lock(self.launch)
        for path in (self.out_path, self.err_path):
            os.close(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
        own = pathlib.Path("/proc/self/cgroup").read_text().split("::", 1)[1].strip()
        parent = pathlib.Path("/sys/fs/cgroup" + os.path.dirname(own))
        candidate = parent / f"hf-12-3-{secrets.token_hex(4)}"
        try:
            candidate.mkdir()
            self.cgroup = candidate
            (candidate / "memory.max").write_text("67108864")
            (candidate / "memory.swap.max").write_text("0")
            (candidate / "cpu.max").write_text("1000000 100000")
        except OSError:
            pass
        self.reply_r, reply_w = os.pipe()
        out_fd, err_fd = os.open(self.out_path, os.O_WRONLY | os.O_APPEND), os.open(self.err_path, os.O_WRONLY | os.O_APPEND)
        self.agent = subprocess.Popen([AGENT_PYTHON, "-I", "-c", AGENT, str(reply_w)], stdin=subprocess.PIPE, stdout=out_fd, stderr=err_fd,
                                      pass_fds=(reply_w,), user=UID, group=UID, extra_groups=[], cwd="/", start_new_session=True, text=True)
        os.close(reply_w); os.close(out_fd); os.close(err_fd)
        self.replies = os.fdopen(self.reply_r, "r")
        if self.cgroup:
            (self.cgroup / "cgroup.procs").write_text(str(self.agent.pid))
        self.agent_start = start_time(self.agent.pid)
        db = sqlite3.connect(self.state / "launches.db")
        db.executescript("CREATE TABLE launches(id TEXT PRIMARY KEY,command TEXT UNIQUE NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,uid INTEGER NOT NULL,gid INTEGER NOT NULL,slot TEXT NOT NULL,identity TEXT NOT NULL,broker_pid INTEGER,broker_start TEXT,agent_pid INTEGER,agent_start TEXT,os_boot TEXT,exit_code INTEGER,updated INTEGER NOT NULL)")
        db.execute("INSERT INTO launches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,unixepoch())",
                   (self.launch, "4e905d41-9f6c-4f88-bc51-3a9d8f314d04", "sha256:" + "0" * 64, "{}", "RUNNING", UID, UID, "5fa16e52-a07d-4099-8d62-4bae90425e05",
                    json.dumps(self.identity), os.getpid(), start_time(os.getpid()), self.agent.pid, self.agent_start, boot_id()))
        db.commit(); db.close()
        os.chmod(self.state / "launches.db", 0o600)

    def command(self, op):
        self.agent.stdin.write(json.dumps(op) + "\n")
        self.agent.stdin.flush()
        return json.loads(self.replies.readline())

    def helper(self, mode, target):
        child = subprocess.Popen([str(self.work / "helper"), mode, str(target), str(UID)], stdout=subprocess.PIPE, text=True)
        self.helpers.append(child)
        line = child.stdout.readline().split()
        if not line or line[0] != "R":
            raise RuntimeError("helper failed: " + " ".join(line))
        return int(line[1])

    def serve_broker(self, state):
        path = str(self.state / f"{self.launch}.sock")
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(path); os.chmod(path, 0o600); server.listen(4)
        launch = self.launch
        def run():
            connection, _ = server.accept()
            with connection:
                size = struct.unpack(">I", connection.recv(4, socket.MSG_WAITALL))[0]
                request = json.loads(connection.recv(size, socket.MSG_WAITALL))
                ok = request["action"] == "launch.status" and request["input"]["launch_id"] == launch
                body = json.dumps({"status": state, "state": state, "launch_id": launch} if ok else {"wrong": True}).encode()
                connection.sendall(struct.pack(">I", len(body)) + body)
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return server, thread

    def cleanup(self):
        complete = True
        if self.agent and self.agent.poll() is None:
            self.agent.kill()
        complete &= kill_slot()
        for child in self.helpers:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait(); complete = False
        if self.agent:
            self.agent.wait(timeout=5)
            self.agent.stdin.close()
        reap_orphans()
        if self.lock_created:
            pathlib.Path(f"/run/hyperfide/slot-{UID}.lock").unlink(missing_ok=True)
        if self.run_created:
            try:
                os.rmdir("/run/hyperfide")
            except OSError:
                pass
        if self.cgroup:
            for _ in range(100):
                try:
                    self.cgroup.rmdir(); break
                except OSError:
                    time.sleep(0.05)
            complete &= not self.cgroup.exists()
        return complete

def member(observation, pid):
    return next((item for item in observation["tree"] if item["process"]["pid"] == pid), None)

def relation(observation, pid):
    item = member(observation, pid)
    return item["relation"] if item else None

def progress_line(sequence, useful, state="WORKING", **extra):
    return json.dumps({"type": "progress", "sequence": sequence, "useful": useful, "state": state, **extra}, separators=(",", ":"))

def scenarios(fx):
    emit("process_tree.root-fixture", True, os.geteuid() == 0 and NATIVE.is_file())
    emit("process_tree.unknown-field-refused", {"code": "INVALID_REQUEST", "exit_nonzero": True, "ok": False, "refused": True}, fx.observe(bogus=1))
    emit("process_tree.identity-mismatch-refused", {"code": "IDENTITY_MISMATCH", "exit_nonzero": True, "ok": False, "refused": True}, fx.observe(boot_generation="9"))
    fx.write_lock("00000000-0000-4000-8000-00000000dead")
    stale = fx.observe()
    fx.write_lock(fx.launch)
    emit("process_tree.stale-slot-owner-refused", "IDENTITY_MISMATCH", stale.get("code"))

    first = fx.observe()
    emit("process_tree.idle-alive-not-progress",
         {"os_liveness": "PRESENT", "agent_liveness": "EXACT_PRESENT", "exact_agent_observed": True, "useful_progress": "NONE_OBSERVED", "execution_state": "IDLE_ALIVE", "authority_renewed": False},
         {k: first[k] for k in ("os_liveness", "agent_liveness", "exact_agent_observed", "useful_progress", "execution_state", "authority_renewed")})
    emit("process_tree.ipc-absent-distinct-from-liveness", ["BROKER_SOCKET_ABSENT", "PRESENT"], [first["ipc_health"], first["os_liveness"]])
    emit("process_tree.reachability-assurance-unobserved", ["UNOBSERVED_BY_SUPERVISOR", "UNOBSERVED_BY_SUPERVISOR", "PRESENT"],
         [first["sandbox_reachability"]["status"], first["assurance_validity"]["status"], first["os_liveness"]])
    server, thread = fx.serve_broker("RUNNING")
    responsive = fx.observe()
    thread.join(5); server.close()
    unresponsive = fx.observe()
    (fx.state / f"{fx.launch}.sock").unlink()
    emit("process_tree.ipc-health-observed", ["RESPONSIVE", "RUNNING", "UNRESPONSIVE", "PRESENT"],
         [responsive["ipc_health"], responsive["broker_reported_state"], unresponsive["ipc_health"], unresponsive["os_liveness"]])

    baseline = first["progress_baseline_next"]
    fx.command({"op": "emit", "lines": ["INFO compiling module %d ... all tests passed SUCCESS" % k for k in range(40)] + [progress_line(0, False, "WORKING")]})
    fx.command({"op": "emit", "stderr": True, "lines": ["warning: verbose diagnostics"]})
    noisy = fx.observe(progress_baseline=baseline)
    emit("process_tree.noop-output-not-progress", {"useful_progress": "NOT_ADVANCED", "execution_state": "ACTIVE_NO_PROGRESS", "output_grew": True, "success_inferred": False, "noop_events": 1},
         {"useful_progress": noisy["useful_progress"], "execution_state": noisy["execution_state"], "output_grew": noisy["progress"]["output_grew"],
          "success_inferred": noisy["progress"]["success_inferred"], "noop_events": noisy["progress"]["noop_events"]})
    baseline = noisy["progress_baseline_next"]
    fx.command({"op": "emit", "lines": [progress_line(1, True)]})
    useful = fx.observe(progress_baseline=baseline)
    emit("process_tree.useful-progress-advanced", ["ADVANCED", "PROGRESSING", 1, "PRESENT"],
         [useful["useful_progress"], useful["execution_state"], useful["progress"]["max_useful_sequence"], useful["os_liveness"]])
    baseline = useful["progress_baseline_next"]
    fx.command({"op": "emit", "lines": [progress_line(1, True)]})
    repeated = fx.observe(progress_baseline=baseline)
    emit("process_tree.repeated-progress-not-advanced", ["NOT_ADVANCED", "ACTIVE_NO_PROGRESS", 1],
         [repeated["useful_progress"], repeated["execution_state"], repeated["progress"]["repeated_events"]])
    states = []
    for sequence, state in enumerate(["MODEL_WAITING", "BUILD_WAITING", "TOOL_ERROR", "AUTH_FAILED", "RATE_LIMITED"], start=2):
        baseline = repeated["progress_baseline_next"]
        fx.command({"op": "emit", "lines": [progress_line(sequence, False, state)]})
        seen = fx.observe(progress_baseline=baseline)
        states.append([seen["execution_state"], seen["useful_progress"], seen["os_liveness"]])
    emit("process_tree.waiting-and-errors-distinct",
         [["MODEL_WAITING", "NOT_ADVANCED", "PRESENT"], ["BUILD_WAITING", "NOT_ADVANCED", "PRESENT"], ["REPORTED_TOOL_ERROR", "NOT_ADVANCED", "PRESENT"],
          ["REPORTED_AUTH_FAILED", "NOT_ADVANCED", "PRESENT"], ["REPORTED_RATE_LIMITED", "NOT_ADVANCED", "PRESENT"]], states)
    before = fx.observe()["progress"]
    fx.command({"op": "emit", "lines": [progress_line(50, True, "WORKING", forged=True), progress_line(51, True, "DONE_SUCCESS"), '{"type":"progress","sequence":"52","useful":true}']})
    forged = fx.observe()
    emit("process_tree.invalid-progress-not-counted", [3, before["max_useful_sequence"], before["useful_events"]],
         [forged["progress"]["invalid_events"] - before["invalid_events"], forged["progress"]["max_useful_sequence"], forged["progress"]["useful_events"]])
    fx.command({"op": "emit", "lines": [progress_line(7, True)]})
    settled = fx.observe()["progress_baseline_next"]
    time.sleep(2.3)
    stalled, idle = fx.observe(progress_baseline=settled, stall_after_seconds=1), fx.observe(progress_baseline=settled)
    emit("process_tree.stalled-distinct-from-idle", ["STALLED", "IDLE_ALIVE", "PRESENT"], [stalled["execution_state"], idle["execution_state"], stalled["os_liveness"]])

    tree = fx.command({"op": "tree"})
    orphan = fx.command({"op": "double_fork"})["orphan"]
    foreign = fx.helper("spawn", 0)
    time.sleep(0.2)
    child_identity = {"pid": tree["child"], "start_time": start_time(tree["child"])}
    grand_identity = {"pid": tree["grandchild"], "start_time": start_time(tree["grandchild"])}
    finished = subprocess.Popen(["/bin/true"]); finished.wait()
    gone_identity = {"pid": finished.pid, "start_time": "1"}
    spread = fx.observe(native_children=[child_identity, gone_identity])
    child, grand = member(spread, tree["child"]), member(spread, tree["grandchild"])
    emit("process_tree.descendants-tracked", [["DESCENDANT", 1], ["DESCENDANT", 2]], [[child and child["relation"], child and child["depth"]], [grand and grand["relation"], grand and grand["depth"]]])
    orphan_item = member(spread, orphan)
    emit("process_tree.setsid-orphan-accounted", ["ADOPTED_BY_BROKER", True], [orphan_item and orphan_item["relation"], orphan_item and orphan_item["left_session"]])
    expected_pids = sorted([fx.agent.pid, tree["child"], tree["grandchild"], orphan, foreign])
    emit("process_tree.foreign-spawn-accounted", ["ESCAPED", expected_pids, sorted(slot_pids())],
         [relation(spread, foreign), sorted(item["process"]["pid"] for item in spread["tree"]), expected_pids])
    emit("process_tree.native-child-flagged", [True, False, ["EXACT_PRESENT", "EXITED"], 3],
         [child and child["native_child_agent"], grand and grand["native_child_agent"], [item["status"] for item in spread["native_children"]], spread["accounting"]["undeclared_non_agent"]])
    acct = spread["accounting"]
    inside = sum(item["process"]["resident_pages"] for item in spread["tree"] if item["relation"] in ("AGENT", "DESCENDANT"))
    outside = sum(item["process"]["resident_pages"] for item in spread["tree"] if item["relation"] not in ("AGENT", "DESCENDANT"))
    emit("process_tree.child-usage-accounted", {"agent": 1, "descendants": 2, "adopted_by_broker": 1, "escaped": 1, "accountable_processes": 5, "tree_resident_pages": inside, "outside_tree_resident_pages": outside, "children_resident": True},
         {**{k: acct[k] for k in ("agent", "descendants", "adopted_by_broker", "escaped", "accountable_processes", "tree_resident_pages", "outside_tree_resident_pages")},
          "children_resident": all(member(spread, pid)["process"]["resident_pages"] > 0 for pid in (tree["child"], tree["grandchild"]))})
    if fx.cgroup:
        limits = spread["limits"]
        emit("process_tree.foreign-outside-job-limits-flagged", [False, 1], [limits["cgroup"]["covers_all_accountable"], limits["cgroup"]["outside_job_cgroup"]])
        emit("process_tree.cgroup-limits-reported", ["CGROUP_V2", "67108864", "0", "1000000 100000", False, False],
             [limits["scope"], limits["cgroup"]["memory"]["max"], limits["cgroup"]["memory"]["swap_max"], limits["cgroup"]["cpu"]["max"], limits["cgroup"]["memory"]["saturated"], limits["saturated"]])
        hog = fx.command({"op": "hog"})["hog"]
        killed = wait_gone(hog, 20)
        saturated = fx.observe()
        memory = saturated["limits"]["cgroup"]["memory"]
        emit("process_tree.memory-saturation-reported", [True, True, True, True, "PRESENT"],
             [killed, memory["saturated"], "cgroup.memory" in saturated["limits"]["saturated_dimensions"], saturated["limits_saturated"], saturated["os_liveness"]])
    else:
        emit("process_tree.foreign-outside-job-limits-flagged", "cgroup v2 fixture", "cgroup v2 unavailable")
        emit("process_tree.cgroup-limits-reported", "cgroup v2 fixture", "cgroup v2 unavailable")
        emit("process_tree.memory-saturation-reported", "cgroup v2 fixture", "cgroup v2 unavailable")

    # Kill a tracked descendant, then force its PID onto an unrelated slot process.
    os.kill(tree["child"], signal.SIGKILL)
    freed = wait_gone(tree["child"])
    reused = fx.helper("reuse", tree["child"])
    time.sleep(0.1)
    reuse = fx.observe(tracked=[child_identity, grand_identity])
    emit("process_tree.killed-pid-reuse-detected", [True, tree["child"], ["PID_REUSED", "EXACT_PRESENT"], "ESCAPED", "ADOPTED_BY_BROKER"],
         [freed, reused, [item["status"] for item in reuse["tracked"]], relation(reuse, tree["child"]), relation(reuse, tree["grandchild"])])
    os.kill(tree["grandchild"], signal.SIGKILL)
    wait_gone(tree["grandchild"])
    exited = fx.observe(tracked=[grand_identity])
    emit("process_tree.stale-identity-exited", ["EXITED", None], [exited["tracked"][0]["status"], member(exited, tree["grandchild"])])

    unsaturated = fx.observe()["limits"]["rlimits"]
    tasks = unsaturated["slot_tasks_in_use"]
    spawned = fx.command({"op": "nproc", "limit": tasks + 2})
    nproc = fx.observe()
    emit("process_tree.nproc-saturation-reported", [False, True, True, str(tasks + 2), True, "PRESENT"],
         [unsaturated["nproc_saturated"], spawned["refused"], nproc["limits"]["rlimits"]["nproc_saturated"], nproc["limits"]["rlimits"]["nproc_soft_min"],
          "rlimit.nproc" in nproc["limits"]["saturated_dimensions"], nproc["os_liveness"]])

    agent_pid = fx.agent.pid
    # The kernel keeps a PID allocated while it names a live session or group, so
    # retire the agent's session members before forcing reuse of the agent PID.
    for pid in slot_pids():
        if pid != agent_pid and session_of(pid) == agent_pid:
            os.kill(pid, signal.SIGKILL)
    fx.agent.kill(); fx.agent.wait(timeout=10)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and any(session_of(int(e)) == agent_pid for e in os.listdir("/proc") if e.isdigit()):
        reap_orphans(); time.sleep(0.02)
    reused_agent = fx.helper("reuse", agent_pid)
    time.sleep(0.1)
    impostor = fx.observe()
    emit("process_tree.agent-pid-reuse-not-adopted", [agent_pid, "PID_REUSED", False, "ESCAPED", "PRESENT"],
         [reused_agent, impostor["agent_liveness"], impostor["exact_agent_observed"], relation(impostor, agent_pid), impostor["os_liveness"]])

    probe = subprocess.run([str(fx.work / "cancel")], input=json.dumps(fx.request()), text=True, capture_output=True, timeout=60)
    reap_orphans()
    emit("process_tree.tree-cancellation-complete", [{"binding": True, "cancelled": True, "remaining": 0}, []],
         [json.loads(probe.stdout or "{}"), slot_pids()])
    quiet = fx.observe()
    emit("process_tree.exited-tree-quiescent", {"os_liveness": "QUIESCENT", "agent_liveness": "EXITED", "execution_state": "QUIESCENT", "accountable_processes": 0, "exact_agent_observed": False},
         {"os_liveness": quiet["os_liveness"], "agent_liveness": quiet["agent_liveness"], "execution_state": quiet["execution_state"],
          "accountable_processes": quiet["accounting"]["accountable_processes"], "exact_agent_observed": quiet["exact_agent_observed"]})

    fx.helper("swarm", 1030)
    deadline = time.monotonic() + 30
    while len(slot_pids()) < 1031 and time.monotonic() < deadline:
        time.sleep(0.05)
    emit("process_tree.inventory-overflow-refused", [True, "PROCESS_INVENTORY_INCOMPLETE"], [len(slot_pids()) > 1024, fx.observe().get("code")])
    kill_slot()

def build(work):
    for name, source, extra in (("helper", HELPER, []), ("cancel", CANCEL, [str(ROOT / "src/hyperfide" / p) for p in
            ("process_tree.c", "launch.c", "job.c", "supervisor.c", "supervisor_daemon.c", "transport.c")] + ["-lsqlite3", "-lcurl", "-lcrypto"])):
        path = work / (name + ".c")
        path.write_text(source)
        # Keep the cancellation probe independent of unused job-launch integrations.
        compiled = subprocess.run(["cc", "-std=gnu11", "-O1", "-ffunction-sections", "-fdata-sections", "-Wl,--gc-sections", "-Wall", "-Wextra", "-Werror", "-Wno-unused-parameter", "-I", str(ROOT / "src/hyperfide"), str(path), *extra, "-o", str(work / name)],
                                  capture_output=True, text=True)
        if compiled.returncode:
            raise RuntimeError(compiled.stderr)

def main():
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise RuntimeError("child subreaper unavailable")
    with tempfile.TemporaryDirectory(prefix="hf-12-3-") as temp:
        work = pathlib.Path(temp)
        os.chmod(work, 0o700)
        fx = Fixture(work)
        complete = False
        try:
            build(work)
            fx.setup()
            scenarios(fx)
        finally:
            complete = fx.cleanup()
            print(json.dumps({"type": "cleanup", "resources": [], "complete": complete}), flush=True)
    return 1 if FAILED or not complete else 0

if __name__ == "__main__":
    raise SystemExit(main())
