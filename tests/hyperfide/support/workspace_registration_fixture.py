#!/usr/bin/env python3
"""Native runner slot/workspace fixture for task 12.4 control probes (root only).

It creates exactly the on-disk state the 12.1 slot allocator and 12.2 launch
broker would have produced -- a root-private state directory with launches.db,
the slot ownership lock, the slot database/directories, slot credential files and
real processes under a dedicated slot UID -- so build/hyperfide-native acts on
genuine kernel processes and files. It never fabricates control outcomes.
"""
from __future__ import annotations
import json,os,shutil,signal,sqlite3,subprocess,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
NATIVE=ROOT/"build/hyperfide-native"
LAUNCH_SCHEMA=("CREATE TABLE IF NOT EXISTS launches(id TEXT PRIMARY KEY,command TEXT UNIQUE NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,uid INTEGER NOT NULL,gid INTEGER NOT NULL,slot TEXT NOT NULL,identity TEXT NOT NULL,broker_pid INTEGER,broker_start TEXT,agent_pid INTEGER,agent_start TEXT,os_boot TEXT,exit_code INTEGER,updated INTEGER NOT NULL);"
 "CREATE UNIQUE INDEX IF NOT EXISTS active_slot_uid ON launches(uid) WHERE state NOT IN ('STOPPED','EXITED');")
SLOT_SCHEMA="CREATE TABLE IF NOT EXISTS slots(id TEXT PRIMARY KEY,uid INTEGER UNIQUE NOT NULL,gid INTEGER NOT NULL,boot_id TEXT NOT NULL,preparation TEXT NOT NULL,port INTEGER UNIQUE NOT NULL,state TEXT NOT NULL);"
def uid():return str(uuid.uuid4())
def private(path,value):
    path.write_text(json.dumps(value,separators=(",",":")));path.chmod(0o600)
def uid_processes(user):
    found=[]
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():continue
        try:
            status=(entry/"status").read_text()
            owner=int(next(l for l in status.splitlines() if l.startswith("Uid:")).split()[1])
            state=next(l for l in status.splitlines() if l.startswith("State:")).split()[1]
        except (OSError,StopIteration,ValueError):continue
        if owner==user and state not in ("Z","X"):found.append((int(entry.name),state))
    return found

class NativeRunner:
    """One runner boot: state dir, slot root, runner config and slot UIDs."""
    def __init__(self,base,scope,transport=None):
        if os.geteuid()!=0:raise PermissionError("root required for slot UIDs and /run/hyperfide locks")
        self.base=Path(base);self.base.mkdir(mode=0o700,exist_ok=True);self.base.chmod(0o700)
        self.state=self.base/"state";self.state.mkdir(mode=0o700);self.slots=self.base/"slots";self.slots.mkdir(mode=0o700)
        self.scope=dict(scope);self.boot=Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        self.children=[];self.uids=[];self.locks=[];self.port=41000
        with sqlite3.connect(self.state/"launches.db") as db:db.executescript(LAUNCH_SCHEMA)
        (self.state/"launches.db").chmod(0o600)
        with sqlite3.connect(self.slots/".supervisor-slots.db") as db:db.executescript(SLOT_SCHEMA)
        (self.slots/".supervisor-slots.db").chmod(0o600)
        Path("/run/hyperfide").mkdir(mode=0o700,exist_ok=True);os.chmod("/run/hyperfide",0o700)
        if transport is not None:self.configure(transport)
    def configure(self,transport,name="runner.json"):
        path=self.base/("transport-"+name);private(path,transport)
        config={"transport_config":str(path),"state_dir":str(self.state),"slot_root":str(self.slots),"connector_plan_path":str(self.base/"no-plan.json"),
                "organisation_id":self.scope["organisation_id"],"run_id":self.scope["run_id"],"sandbox_id":self.scope["sandbox_id"],"boot_id":self.scope["boot_id"],"boot_generation":"1","consumer_id":"runner-control-fixture"}
        target=self.state/name if name=="runner.json" else self.base/name
        private(target,config);return target
    def unconfigure(self):
        target=self.state/"runner.json"
        if target.exists():target.unlink()
    def add_slot(self,user,credentials=("worker-token",)):
        if uid_processes(user):raise RuntimeError("slot UID is not quiescent: "+str(user))
        slot=uid();self.uids.append(user);root=self.slots/slot;root.mkdir(mode=0o700);os.chown(root,user,user)
        for name in ("worktree","build","home","tmp","sessions","logs"):
            d=root/name;d.mkdir(mode=0o700);os.chown(d,user,user)
        cred=root/"home/.hyperfide/credentials";cred.mkdir(parents=True,mode=0o700)
        for d in (root/"home/.hyperfide",cred):os.chown(d,user,user);d.chmod(0o700)
        for name in credentials:self.credential(slot,user,name)
        self.port+=1
        with sqlite3.connect(self.slots/".supervisor-slots.db") as db:db.execute("INSERT INTO slots VALUES(?,?,?,?,?,?,'READY')",(slot,user,user,self.scope["boot_id"],"sha256:"+"0"*64,self.port))
        return {"slot_id":slot,"uid":user,"gid":user}
    def credential(self,slot,user,name,data=b"slot-scoped fixture credential"):
        path=self.slots/slot/"home/.hyperfide/credentials"/name;path.write_bytes(data);os.chown(path,user,user);path.chmod(0o600);return path
    def credentials(self,slot):
        d=self.slots/slot/"home/.hyperfide/credentials";return sorted(p.name for p in d.iterdir()) if d.exists() else []
    def slot_state(self,slot):
        with sqlite3.connect(self.slots/".supervisor-slots.db") as db:return db.execute("SELECT state FROM slots WHERE id=?",(slot,)).fetchone()[0]
    def add_launch(self,slot,launch=None,attempt=None,attempt_generation="1",logs=True):
        launch=launch or uid();attempt=attempt or uid()
        identity={"organisation_id":self.scope["organisation_id"],"run_id":self.scope["run_id"],"sandbox_id":self.scope["sandbox_id"],"boot_id":self.scope["boot_id"],"boot_generation":"1",
                  "attempt_id":attempt,"attempt_generation":attempt_generation,"authority_epoch":self.scope.get("epoch",uid()),"agent_session_id":uid()}
        with sqlite3.connect(self.state/"launches.db") as db:
            db.execute("INSERT INTO launches(id,command,digest,body,state,uid,gid,slot,identity,broker_pid,broker_start,agent_pid,agent_start,os_boot,updated) VALUES(?,?,?,?,'RUNNING',?,?,?,?,0,'0',0,'0',?,strftime('%s','now'))",
                       (launch,uid(),"sha256:"+"1"*64,"{}",slot["uid"],slot["gid"],slot["slot_id"],json.dumps(identity,separators=(",",":")),self.boot))
        lock=Path("/run/hyperfide")/("slot-%d.lock"%slot["uid"]);lock.write_text(launch);lock.chmod(0o600);self.locks.append(lock)
        if logs:
            for stream,data in (("stdout",b"agent stdout line\n"*64),("stderr",b"agent stderr line\n")):
                p=self.state/(launch+"."+stream);p.write_bytes(data);p.chmod(0o600)
        return {"launch_id":launch,"attempt_id":attempt,"attempt_generation":attempt_generation,**slot,"identity":identity}
    def launch_state(self,launch):
        with sqlite3.connect(self.state/"launches.db") as db:
            row=db.execute("SELECT state FROM launches WHERE id=?",(launch,)).fetchone();return row[0] if row else None
    def spawn(self,user,code):
        def drop():
            os.setgroups([]);os.setgid(user);os.setuid(user)
        child=subprocess.Popen(["/usr/bin/python3","-I","-c",code],preexec_fn=drop,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,cwd="/")
        self.children.append(child);return child
    def tree(self,user,count=2):
        """A real process tree: a parent with `count` sleeping descendants."""
        code="import os,time\nfor _ in range(%d):\n    if os.fork()==0:\n        time.sleep(600);os._exit(0)\ntime.sleep(600)"%count
        child=self.spawn(user,code);self.wait(lambda:len(uid_processes(user))>=count+1);return child
    def wait(self,condition,timeout=10):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            if condition():return True
            time.sleep(.05)
        return False
    def request(self,launch,command=None,**extra):
        value={"state_dir":str(self.state),"launch_id":launch["launch_id"],"attempt_id":launch["attempt_id"],"attempt_generation":launch["attempt_generation"],
               "sandbox_id":self.scope["sandbox_id"],"boot_id":self.scope["boot_id"],"boot_generation":"1"}
        if command:value["command_id"]=command
        value.update(extra);return value
    def native(self,action,request,timeout=120):
        result=subprocess.run([str(NATIVE),"--component","12.4","--action",action],input=json.dumps(request).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
        reaped=0
        for child in self.children:
            if child.poll() is not None:reaped+=1
        try:body=json.loads(result.stdout or b"{}")
        except ValueError:body={}
        code=result.stderr.decode(errors="replace").strip().rsplit(": ",1)[-1] if result.returncode else None
        return result.returncode,body.get("result") if body.get("ok") else None,code
    def control(self,table,where="",values=()):
        with sqlite3.connect(self.state/"control.db") as db:
            db.row_factory=sqlite3.Row;return [dict(r) for r in db.execute("SELECT * FROM "+table+(" WHERE "+where if where else ""),values)]
    def close(self):
        for user in self.uids:
            for _ in range(50):
                procs=uid_processes(user)
                if not procs:break
                for pid,_state in procs:
                    try:os.kill(pid,signal.SIGCONT);os.kill(pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                time.sleep(.05)
        for child in self.children:
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
        for lock in self.locks:
            if lock.exists():lock.unlink()
        shutil.rmtree(self.base,ignore_errors=True)
        return all(not uid_processes(user) for user in self.uids)
