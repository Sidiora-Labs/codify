#!/usr/bin/env python3
"""Compile and exercise the actual unprivileged preparation phase runner.

Evidence is process/capture/cleanup scoped; it grants no preparation qualification,
provider capacity, credential, model dispatch, or task-completion authority.
"""
import ctypes
import hashlib
import json
import os
import pathlib
import signal
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[3]
UID = 62126
DRIVER = r'''
#define _GNU_SOURCE
#include "src/hyperfide/preparation_process.c"
static int admitted=0,deny=0;
static int admit(void *context,const HfProcessIdentity *p){
 (void)context;HfProcessIdentity actual;
 admitted=hf_process_matches(p,&actual)&&actual.uid==62126&&actual.ppid==getpid()&&actual.state!='Z';
 return admitted&&!deny;
}
static void path(char out[4096],const char *root,const char *name){if(snprintf(out,4096,"%s/%s",root,name)>=4096)exit(90);}
static void directory(const char *name){if(mkdir(name,0700)||chown(name,62126,62126))exit(91);}
int main(int argc,char **argv){
 if(argc!=4||geteuid()!=0)return 90;
 const char *mode=argv[1],*root=argv[2],*payload=argv[3],*operation="00000000-0000-4000-8000-000000062126";
 HfProcessIdentity *inventory=calloc(PP_PROCESSES,sizeof *inventory);size_t initial=0;
 if(!inventory||!pp_inventory(62126,inventory,&initial)||initial)return 92;
 char home[4096],tmp[4096],work[4096],outpath[4096],errpath[4096],marker[4096];
 path(home,root,"home");path(tmp,root,"tmp");path(work,root,"work");directory(home);directory(tmp);directory(work);
 path(outpath,root,"stdout");path(errpath,root,"stderr");path(marker,work,"phase-marker");
 int out=open(outpath,O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC,0600),err=open(errpath,O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC,0600);
 int cwd=open(work,O_RDONLY|O_DIRECTORY|O_CLOEXEC),binary=open(payload,O_RDONLY|O_CLOEXEC);
 int writer=-1;long long now=pp_now(),deadline=now+10000000000LL;
 pid_t guard=hf_slot_watchdog(62126,deadline,&writer,operation);HfProcessIdentity watchdog;
 if(out<0||err<0||cwd<0||binary<0||guard<=0||!hf_process_identity(guard,&watchdog))return 93;
 const char *args[]={payload,mode,marker,NULL};
 const char *env[]={"LANG=C.UTF-8","HF_EXECUTION_HOST_CLASS=PROCESS_FIXTURE",NULL};
 HfPreparationProcessSpec spec={.uid=62126,.gid=62126,.operation_id=operation,.watchdog=&watchdog,
 .executable_fd=binary,.cwd_fd=cwd,.stdout_fd=out,.stderr_fd=err,.argv=args,.environment=env,
 .home=home,.tmp=tmp,.deadline_ns=deadline,.output_limit_bytes=16*1024*1024,.admit_child=admit};
 HfPreparationProcessResult result;
 if(!strcmp(mode,"deadline"))spec.deadline_ns=now+500000000LL;
 if(!strcmp(mode,"overflow"))spec.output_limit_bytes=65536;
 if(!strcmp(mode,"deny"))deny=1;
 if(!strcmp(mode,"uid-sentinel"))spec.uid=(uid_t)-1;
 if(!strcmp(mode,"gid-sentinel"))spec.gid=(gid_t)-1;
 if(!strcmp(mode,"unsafe-env")){static const char *bad[]={"NODE_OPTIONS=--eval=bad",NULL};spec.environment=bad;}
 if(!strcmp(mode,"duplicate-env")){static const char *bad[]={"LANG=C","LANG=C.UTF-8",NULL};spec.environment=bad;}
 if(!strcmp(mode,"unsafe-log"))fchmod(out,0644);
 if(!strcmp(mode,"native-bad-action")||!strcmp(mode,"native")){
  spec.executable_fd=-1;spec.argv=NULL;spec.native_entry=hf_component_11_3;
  spec.native_action=!strcmp(mode,"native")?"environment.readiness":"environment.seal";spec.native_request="{}";
 }
 if(!strcmp(mode,"parent-death")){
  printf("{\"controller\":%ld,\"watchdog\":%ld}\n",(long)getpid(),(long)guard);fflush(stdout);
 }
 if(!strcmp(mode,"capabilities")&&prctl(PR_SET_KEEPCAPS,1))return 94;
 HfProcessIdentity wrong=watchdog;wrong.start_time++;
 if(!strcmp(mode,"wrong-watchdog"))spec.watchdog=&wrong;
 if(!strcmp(mode,"wrong-owner"))spec.operation_id="00000000-0000-4000-8000-000000062127";
 if(!strcmp(mode,"expired"))spec.deadline_ns=now-1;
 if(!strcmp(mode,"shared-log"))spec.stderr_fd=out;
 if(!strcmp(mode,"relative-executable"))args[0]="payload";
 if(!strcmp(mode,"setup-failure")){if(chown(work,0,0))return 95;}
 int first_complete=0;pid_t first_pid=0;
 int returned=hf_preparation_process(&spec,&result);
 if(!strcmp(mode,"repeat")){
  first_complete=returned==1&&result.uid_absent&&result.output_complete;
  first_pid=result.process.pid;close(out);close(err);
  path(outpath,root,"stdout2");path(errpath,root,"stderr2");
  out=open(outpath,O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC,0600);err=open(errpath,O_CREAT|O_EXCL|O_RDWR|O_CLOEXEC,0600);
  if(out<0||err<0)return 96;
  spec.stdout_fd=out;spec.stderr_fd=err;returned=hf_preparation_process(&spec,&result);
 }
 HfProcessIdentity guard_observed;int guard_live=hf_process_matches(&watchdog,&guard_observed)&&guard_observed.state!='Z';
 int owner=hf_slot_owner(62126,operation),status=0;
 pid_t waitcheck=waitpid(guard,&status,WNOHANG);
 size_t remaining=0;int scanned=pp_inventory(62126,inventory,&remaining);
 int finished=hf_slot_watchdog_finish(guard,&writer);
 printf("{\"return\":%d,\"admitted\":%d,\"exit_code\":%d,\"signal\":%d,\"timed_out\":%s,\"interrupted\":%s,\"output_complete\":%s,\"uid_absent\":%s,\"stdout_bytes\":%llu,\"stderr_bytes\":%llu,\"stdout_digest\":\"%s\",\"stderr_digest\":\"%s\",\"started_at\":\"%s\",\"ended_at\":\"%s\",\"duration_ms\":%lld,\"watchdog_live\":%s,\"owner_retained\":%s,\"watchdog_unreaped\":%s,\"watchdog_finished\":%s,\"inventory_complete\":%s,\"remaining\":%zu,\"process\":",
 returned,admitted,result.exit_code,result.signal,result.timed_out?"true":"false",result.interrupted?"true":"false",result.output_complete?"true":"false",result.uid_absent?"true":"false",result.stdout_bytes,result.stderr_bytes,result.stdout_digest,result.stderr_digest,result.started_at,result.ended_at,result.duration_ms,guard_live?"true":"false",owner?"true":"false",waitcheck==0?"true":"false",finished?"true":"false",scanned?"true":"false",remaining);
 if(result.process.pid>0)hf_process_json(stdout,&result.process);else fputs("null",stdout);fprintf(stdout,",\"first_phase_complete\":%s,\"first_pid\":%ld}\n",first_complete?"true":"false",(long)first_pid);fflush(stdout);
 close(binary);close(cwd);close(out);close(err);free(inventory);return 0;
}
'''
PAYLOAD = r'''
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <linux/capability.h>
#include <sys/syscall.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <unistd.h>
static int full(int fd,const char *data,size_t n){
 while(n){ssize_t written=write(fd,data,n);if(written<0&&errno==EINTR)continue;if(written<=0)return 0;data+=written;n-=(size_t)written;}return 1;
}
int main(int argc,char **argv){
 if(argc<2)return 90;
 const char *mode=argv[1];
 /* This host's Rust coreutils rejects an fd-based AT_EXECFN. The fixed
  * root-owned recipe executes the actual /usr/bin/id after UID admission. */
 if(!strcmp(mode,"id")){char *const id_argv[]={"/usr/bin/id","-u",NULL};execv(id_argv[0],id_argv);return 95;}
 if(!strcmp(mode,"full")||!strcmp(mode,"overflow")){
  char data[4096];memset(data,'O',sizeof data);for(int n=0;n<1024;n++)if(!full(1,data,sizeof data))return 91;
  memset(data,'E',sizeof data);for(int n=0;n<1024;n++)if(!full(2,data,sizeof data))return 92;return 0;
 }
 if(!strcmp(mode,"detach")){
  pid_t child=fork();if(child<0)return 91;
  if(child==0){setsid();signal(SIGTERM,SIG_IGN);for(;;)pause();}
  printf("%ld\n",(long)child);fflush(stdout);return 0;
 }
 if(!strcmp(mode,"parent-death")){
  int ready[2];if(pipe(ready))return 97;pid_t detached=fork();if(detached<0)return 98;
  if(detached==0){close(ready[0]);if(setsid()<0||prctl(PR_SET_PDEATHSIG,0))_exit(99);signal(SIGTERM,SIG_IGN);
   if(write(ready[1],"R",1)!=1)_exit(100);
   close(ready[1]);for(;;)pause();}
  close(ready[1]);char noticed;if(read(ready[0],&noticed,1)!=1)return 101;close(ready[0]);
  printf("%ld %ld\n",(long)getpid(),(long)detached);fflush(stdout);for(;;)pause();
 }
 if(!strcmp(mode,"deadline")){
  printf("%ld\n",(long)getpid());fflush(stdout);
  for(;;)pause();
 }
 if(!strcmp(mode,"nonzero")){fputs("real nonzero\n",stdout);fputs("diagnostic\n",stderr);return 7;}
 if(!strcmp(mode,"deny")){int fd=open(argv[2],O_WRONLY|O_CREAT|O_EXCL,0600);if(fd>=0){if(write(fd,"EXECUTED",8)!=8)return 93;close(fd);}return 0;}
 struct __user_cap_header_struct cap_header={.version=_LINUX_CAPABILITY_VERSION_3,.pid=0};
 struct __user_cap_data_struct caps[2]={{0},{0}};
 if(syscall(SYS_capget,&cap_header,caps))return 96;
 int caps_empty=!(caps[0].effective|caps[0].permitted|caps[0].inheritable|caps[1].effective|caps[1].permitted|caps[1].inheritable);
 char cwd[4096];if(!getcwd(cwd,sizeof cwd))return 94;gid_t groups[16];int n=getgroups(16,groups),fds=0;
 for(int fd=3;fd<256;fd++)if(fcntl(fd,F_GETFD)>=0)fds++;
 printf("{\"uid\":%lu,\"euid\":%lu,\"gid\":%lu,\"egid\":%lu,\"groups\":%d,\"no_new_privs\":%d,\"pdeathsig\":",(unsigned long)getuid(),(unsigned long)geteuid(),(unsigned long)getgid(),(unsigned long)getegid(),n,prctl(PR_GET_NO_NEW_PRIVS,0,0,0,0));
 int death=0;prctl(PR_GET_PDEATHSIG,&death);printf("%d,\"extra_fds\":%d,\"secret_absent\":%s,\"node_options_absent\":%s,\"home\":\"%s\",\"tmp\":\"%s\",\"job_home\":\"%s\",\"job_tmp\":\"%s\",\"cwd\":\"%s\",\"lang\":\"%s\",\"stdin_eof\":%s}\n",death,fds,getenv("HF_PROCESS_FIXTURE_SECRET")==NULL?"true":"false",getenv("NODE_OPTIONS")==NULL?"true":"false",getenv("HOME"),getenv("TMPDIR"),getenv("HF_JOB_HOME"),getenv("HF_JOB_TMPDIR"),cwd,getenv("LANG"),getchar()==EOF?"true":"false");
 fprintf(stderr,"capabilities_empty=%d\n",caps_empty);
 return 0;
}
'''

def uid_processes():
    result = []
    for entry in pathlib.Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            status = (entry / "status").read_text()
            line = next(line for line in status.splitlines() if line.startswith("Uid:"))
            if int(line.split()[2]) == UID:
                result.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError, StopIteration):
            pass
    return result


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Actual process fixture requires root to drop an exclusive UID")
    if uid_processes():
        raise RuntimeError("Fixture UID is already occupied; refusing to signal it")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0):
        raise OSError(ctypes.get_errno(), "PR_SET_CHILD_SUBREAPER")
    checks = 0

    def check(name, ok):
        nonlocal checks
        checks += 1
        print(json.dumps({"type": "assertion", "id": "preparation.process." + name,
                          "expected": True, "actual": bool(ok)}), flush=True)
        if not ok:
            raise AssertionError(name)

    with tempfile.TemporaryDirectory(prefix="hyperfide-preparation-process-") as temp:
        base = pathlib.Path(temp)
        base.chmod(0o711)
        driver_source, payload_source = base / "driver.c", base / "payload.c"
        driver_source.write_text(DRIVER)
        payload_source.write_text(PAYLOAD)
        driver, payload = base / "driver", base / "payload"
        files = ["supervisor.c", "launch.c", "transport.c", "readiness.c"]
        flags = ["cc", "-std=gnu11", "-O1", "-Wall", "-Wextra", "-Werror",
                 "-ffunction-sections", "-fdata-sections", "-I", str(ROOT),
                 "-I", str(ROOT / "src/hyperfide")]
        compile_driver = subprocess.run(
            [*flags, str(driver_source), *[str(ROOT / "src/hyperfide" / p) for p in files],
             "-Wl,--gc-sections", "-lsqlite3", "-lcurl", "-lcrypto", "-o", str(driver)],
            cwd=ROOT, capture_output=True, text=True)
        if compile_driver.returncode:
            raise RuntimeError(compile_driver.stderr)
        payload_compile = subprocess.run([*flags, str(payload_source), "-o", str(payload)],
                                        cwd=ROOT, capture_output=True, text=True)
        if payload_compile.returncode:
            raise RuntimeError(payload_compile.stderr)
        payload.chmod(0o755)
        check("actual-source-compiled-Werror", True)
        inherited = dict(os.environ, HF_PROCESS_FIXTURE_SECRET="MUST_NOT_REACH_CHILD",
                         NODE_OPTIONS="--invalid-inherited-option")

        def run(mode):
            folder = base / mode
            folder.mkdir(mode=0o711)
            folder.chmod(0o711)
            completed = subprocess.run([str(driver), mode, str(folder), str(payload)],
                                       env=inherited, capture_output=True, text=True, timeout=20)
            if completed.returncode:
                raise RuntimeError(mode + ": " + completed.stderr + completed.stdout)
            result = json.loads(completed.stdout)
            if result["exit_code"] != 0:
                print(json.dumps({"type": "phase_diagnostic", "scenario": mode, "stderr": (folder / "stderr").read_text(errors="replace")[:512]}), flush=True)
            print(json.dumps({"type": "observation", "scenario": mode, "result": result}), flush=True)
            check(mode + "-watchdog-retained",
                  result["watchdog_live"] and result["owner_retained"]
                  and result["watchdog_unreaped"] and result["watchdog_finished"])
            check(mode + "-no-owned-processes", result["inventory_complete"] and result["remaining"] == 0
                  and not uid_processes())
            if result["return"] >= 0:
                for stream in ("stdout", "stderr"):
                    data = (folder / (stream + ("2" if mode == "repeat" else ""))).read_bytes()
                    check(mode + "-" + stream + "-raw-digest",
                          len(data) == result[stream + "_bytes"]
                          and "sha256:" + hashlib.sha256(data).hexdigest() == result[stream + "_digest"])
            return result, folder

        result, folder = run("id")
        check("real-id-under-target-uid", result["return"] == 1 and result["exit_code"] == 0
              and (folder / "stdout").read_text() == str(UID) + "\n"
              and result["process"]["uid"] == UID and int(result["process"]["start_time"]) > 0)
        result, folder = run("environment")
        observed = json.loads((folder / "stdout").read_text())
        check("dropped-all-identities-and-groups", all(observed[k] == UID for k in ("uid", "euid", "gid", "egid"))
              and observed["groups"] == 0)
        check("nonprivileged-parent-death-and-no-fds", observed["no_new_privs"] == 1
              and observed["pdeathsig"] == signal.SIGKILL and observed["extra_fds"] == 0)
        check("fresh-nonsecret-environment", observed["secret_absent"] and observed["node_options_absent"]
              and observed["lang"] == "C.UTF-8")
        check("protected-paths-and-stdin-eof", observed["home"] == str(folder / "home")
              and observed["tmp"] == str(folder / "tmp") and observed["job_home"] == observed["home"]
              and observed["job_tmp"] == observed["tmp"] and observed["cwd"] == str(folder / "work")
              and observed["stdin_eof"])
        check("actual-child-admitted-before-execution", result["admitted"] == 1)
        result, folder = run("repeat")
        check("same-watchdog-survives-two-cleanly-separated-phases",
              result["return"] == 1 and result["first_phase_complete"]
              and result["first_pid"] > 1 and result["first_pid"] != result["process"]["pid"]
              and (folder / "stdout").read_bytes() == (folder / "stdout2").read_bytes())
        result, _ = run("setup-failure")
        check("pre-execution-failure-reaped-without-running",
              result["return"] == 0 and result["admitted"] == 0 and result["uid_absent"])
        result, folder = run("capabilities")
        check("inherited-keepcaps-cannot-retain-permitted-capabilities",
              result["return"] == 1 and (folder / "stderr").read_text() == "capabilities_empty=1\n")
        result, folder = run("full")
        check("full-both-streams-no-deadlock", result["return"] == 1 and result["output_complete"]
              and (folder / "stdout").read_bytes() == b"O" * (4 * 1024 * 1024)
              and (folder / "stderr").read_bytes() == b"E" * (4 * 1024 * 1024))
        result, folder = run("nonzero")
        check("nonzero-is-observed-not-success", result["return"] == 1 and result["exit_code"] == 7)
        result, folder = run("detach")
        check("detached-descendant-killed-and-reaped", result["uid_absent"] and result["interrupted"]
              and result["output_complete"] and int((folder / "stdout").read_text()) > 1)
        result, _ = run("deadline")
        check("actual-monotonic-deadline-enforced", result["timed_out"] and result["interrupted"]
              and result["uid_absent"] and 100 <= result["duration_ms"] < 4000)
        result, _ = run("overflow")
        check("combined-output-cap-preserves-unknown", result["return"] == 0 and result["interrupted"]
              and not result["output_complete"] and result["stdout_bytes"] + result["stderr_bytes"] == 65536)
        result, folder = run("deny")
        check("budget-admission-refusal-never-executes", result["return"] == 0 and result["admitted"] == 1
              and not (folder / "work" / "phase-marker").exists() and result["stdout_bytes"] == 0)
        for mode in ("uid-sentinel", "gid-sentinel", "unsafe-env", "duplicate-env", "unsafe-log", "native-bad-action", "wrong-watchdog", "wrong-owner", "expired", "shared-log", "relative-executable"):
            result, _ = run(mode)
            check(mode + "-refused-before-execution", result["return"] == -1 and result["admitted"] == 0)
        result, folder = run("native")
        check("actual-linked-readiness-is-unprivileged-and-unqualified",
              result["return"] == 1 and result["process"]["uid"] == UID
              and result["exit_code"] != 0 and result["output_complete"]
              and result["exit_code"] == 2 and (folder / "stdout").read_bytes() == b"")

        folder = base / "parent-death"
        folder.mkdir(mode=0o711)
        folder.chmod(0o711)
        controller = subprocess.Popen([str(driver), "parent-death", str(folder), str(payload)],
                                      env=inherited, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        announcement = json.loads(controller.stdout.readline())
        ready_until = time.monotonic() + 5
        while time.monotonic() < ready_until and not (folder / "stdout").stat().st_size:
            time.sleep(.01)
        observed_before_death = [int(value) for value in (folder / "stdout").read_text().split()]
        check("parent-death-real-child-started", len(observed_before_death) == 2
              and all(pid in uid_processes() for pid in observed_before_death))
        os.kill(controller.pid, signal.SIGKILL)
        controller.wait(timeout=5)
        cleanup_until = time.monotonic() + 5
        observed_uid = uid_processes()
        while time.monotonic() < cleanup_until:
            for pid in uid_processes() + [announcement["watchdog"]]:
                try:
                    os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    pass
            observed_uid = uid_processes()
            try:
                os.kill(announcement["watchdog"], 0)
                guard_alive = True
            except ProcessLookupError:
                guard_alive = False
            if not observed_uid and not guard_alive:
                break
            time.sleep(.01)
        check("parent-death-independent-watchdog-cleans-uid", not observed_uid and not guard_alive)
        controller.stdout.close()
        controller.stderr.close()
        check("all-scenarios-leave-no-uid-process", not uid_processes())
    print(json.dumps({"type": "preparation_process_fixture", "assertions": checks,
                      "qualification": False, "scope": "ACTUAL_LINUX_PROCESS_CAPTURE_CLEANUP"}), flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
