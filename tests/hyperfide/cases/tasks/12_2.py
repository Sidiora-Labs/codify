#!/usr/bin/env python3
"""Exercise the actual native deadline watchdog and SQLite ACK implementation.
This bounded component probe grants no frontier dispatch/task qualification."""
import json, pathlib, subprocess, tempfile
ROOT=pathlib.Path(__file__).resolve().parents[4]
PROBE=r'''
#define _GNU_SOURCE
#include "src/hyperfide/launch.c"
static int checks=0;
static void check(int ok,const char *id){++checks;printf("{\"type\":\"assertion\",\"id\":\"%s\",\"expected\":true,\"actual\":%s}\n",id,ok?"true":"false");fflush(stdout);if(!ok)exit(1);}
static pid_t worker(uid_t uid){
 int pipefd[2];if(pipe(pipefd))exit(2);pid_t child=fork();
 if(!child){close(pipefd[0]);if(setgroups(0,NULL)||setgid(uid)||setuid(uid))_exit(125);if(write(pipefd[1],"R",1)!=1)_exit(125);close(pipefd[1]);for(;;)pause();}
 close(pipefd[1]);char ready;int ok=read(pipefd[0],&ready,1)==1&&ready=='R';close(pipefd[0]);if(!ok)exit(2);return child;
}
static int dead(pid_t pid){HfProcessIdentity p;return !hf_process_identity(pid,&p)||p.state=='Z'||p.state=='X';}
static void reap(pid_t child){int status;while(waitpid(child,&status,0)<0&&errno==EINTR){}}
int main(void){
 signal(SIGPIPE,SIG_IGN);check(geteuid()==0,"runner.watchdog.root-fixture");
 uid_t uid=62031;HfProcessIdentity items[1024];check(uid_processes(uid,items,1024)==0,"runner.watchdog.exclusive-uid");
 pid_t child=worker(uid);int writer=-1;pid_t guard=hf_slot_watchdog(uid,monotonic_ns()+150000000LL,&writer,"00000000-0000-4000-8000-000000000001");
 check(guard>0,"runner.watchdog.created");usleep(450000);
 check(dead(child),"runner.watchdog.blocked-controller-deadline");close(writer);reap(child);reap(guard);
 child=worker(uid);guard=hf_slot_watchdog(uid,monotonic_ns()+5000000000LL,&writer,"00000000-0000-4000-8000-000000000001");
 check(guard>0,"runner.watchdog.pipe-loss-created");close(writer);usleep(300000);
 check(dead(child),"runner.watchdog.broker-death-pipe-loss");reap(child);reap(guard);
 child=worker(uid);guard=hf_slot_watchdog(uid,monotonic_ns()+400000000LL,&writer,"00000000-0000-4000-8000-000000000001");usleep(100000);
 long long renewed=monotonic_ns()+800000000LL;
 check(write(writer,&renewed,sizeof renewed)==sizeof renewed,"runner.watchdog.renewal-delivered");usleep(450000);
 check(!dead(child),"runner.watchdog.primary-renewal-preserved");close(writer);usleep(300000);
 check(dead(child),"runner.watchdog.renewed-broker-death");reap(child);reap(guard);
 child=worker(uid);guard=hf_slot_watchdog(uid,monotonic_ns()+100000000LL,&writer,"00000000-0000-4000-8000-000000000001");usleep(350000);
 check(dead(child),"runner.watchdog.expired-cannot-revive");renewed=monotonic_ns()+1000000000LL;
 check(write(writer,&renewed,sizeof renewed)!=sizeof renewed,"runner.watchdog.late-renewal-refused");close(writer);reap(child);reap(guard);
 check(uid_processes(uid,items,1024)==0,"runner.watchdog.no-owned-descendants");
 child=worker(uid);guard=hf_slot_watchdog(uid,monotonic_ns()+500000000LL,&writer,"00000000-0000-4000-8000-000000000001");
 int collision_writer=-1;pid_t collision=hf_slot_watchdog(uid,monotonic_ns()+500000000LL,&collision_writer,"00000000-0000-4000-8000-000000000002");
 check(collision<0,"runner.slot.concurrent-owner-refused");
 check(hf_slot_control_lock(uid,"00000000-0000-4000-8000-000000000001")<0,"runner.slot.active-watchdog-locks-cleanup");
 check(stop_uid(uid),"runner.slot.old-owner-processes-stopped");
 check(hf_slot_watchdog_finish(guard,&writer),"runner.slot.old-watchdog-retired");
 child=worker(uid);guard=hf_slot_watchdog(uid,monotonic_ns()+1500000000LL,&writer,"00000000-0000-4000-8000-000000000002");
 check(guard>0,"runner.slot.new-generation-owner");
 check(!hf_slot_owner(uid,"00000000-0000-4000-8000-000000000001"),"runner.slot.stale-owner-rejected");
 usleep(650000);check(!dead(child),"runner.slot.old-deadline-cannot-kill-new-generation");
 close(writer);reap(child);reap(guard);
 int ownership=hf_slot_control_lock(uid,"00000000-0000-4000-8000-000000000002");
 check(ownership>=0,"runner.slot.quiescent-owner-cleanup-lock");if(ownership>=0)close(ownership);
 sqlite3 *db=NULL;check(sqlite3_open(":memory:",&db)==SQLITE_OK,"runner.ack.real-sqlite");
 check(sqlite3_exec(db,"CREATE TABLE native_ack_outbox(command TEXT,version INTEGER,payload TEXT,PRIMARY KEY(command,version));CREATE TABLE accepted(command TEXT PRIMARY KEY);BEGIN IMMEDIATE;INSERT INTO accepted VALUES('command');",NULL,NULL,NULL)==SQLITE_OK,"runner.ack.acceptance-transaction");
 RunnerConfig config={0};Instruction i={0};
 snprintf(i.command,sizeof i.command,"00000000-0000-4000-8000-000000000001");
 check(queue_ack(db,&config,&i,1,"ACCEPTED",NULL),"runner.ack.checked-persist");
 check(sqlite3_exec(db,"COMMIT",NULL,NULL,NULL)==SQLITE_OK,"runner.ack.atomic-commit");
 check(queue_ack(db,&config,&i,1,"ACCEPTED",NULL),"runner.ack.identical-replay");
 check(!queue_ack(db,&config,&i,1,"UNCERTAIN",NULL),"runner.ack.conflicting-replay-denied");
 check(sqlite3_exec(db,"PRAGMA query_only=ON",NULL,NULL,NULL)==SQLITE_OK,"runner.ack.write-fault-injected");
 check(!queue_ack(db,&config,&i,2,"EXECUTING",NULL),"runner.ack.write-failure-observed");
 check(sqlite3_exec(db,"PRAGMA query_only=OFF;CREATE TABLE frames(id TEXT PRIMARY KEY,launch TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL);",NULL,NULL,NULL)==SQLITE_OK,"runner.frame.real-ledger");
 check(frame_reserve(db,"frame-a","launch-a","sha256:a")==1,"runner.frame.first-intent");
 check(frame_reserve(db,"frame-a","launch-a","sha256:a")==0,"runner.frame.exact-never-replays");
 check(frame_reserve(db,"frame-a","launch-b","sha256:a")==-1,"runner.frame.cross-launch-conflict");
 check(frame_reserve(db,"frame-a","launch-a","sha256:b")==-1,"runner.frame.changed-bytes-conflict");
 check(sqlite3_exec(db,"PRAGMA query_only=ON",NULL,NULL,NULL)==SQLITE_OK,"runner.frame.write-fault");
 check(frame_reserve(db,"frame-b","launch-a","sha256:a")==-2,"runner.frame.ledger-fault-refused");
 sqlite3_close(db);return checks==35?0:3;
}
'''
def main():
    with tempfile.TemporaryDirectory(prefix="hyperfide-native-watchdog-") as temp:
        work=pathlib.Path(temp);probe=work/"probe.c";binary=work/"probe"
        probe.write_text(PROBE)
        files=["supervisor.c","transport.c","process_tree.c","control.c","job.c"]
        command=["cc","-std=gnu11","-O1","-Wall","-Wextra","-Werror","-I",str(ROOT),"-I",str(ROOT/"src/hyperfide"),str(probe),*[str(ROOT/"src/hyperfide"/p) for p in files],"-lsqlite3","-lcurl","-lcrypto","-o",str(binary)]
        subprocess.run(command,check=True,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        result=subprocess.run([str(binary)],cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
        print(result.stdout,end="")
        if result.stderr: print(result.stderr,end="",file=__import__("sys").stderr)
        return result.returncode
if __name__=="__main__":raise SystemExit(main())
