#!/usr/bin/env python3
"""Real cgroup-v2 budget primitive probes; no signed-charge or job qualification.

The trusted C API receives explicit fixture inputs. Production authentication
remains at the native14/05 claim boundary. No ordinary directory is ever treated
as an enforcing cgroup, and unavailable delegation is reported explicitly.
"""
from __future__ import annotations
import json,os,subprocess,tempfile,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
DRIVER=r"""
#define _GNU_SOURCE
#include "supervisor.h"
#include <errno.h>
#include <fcntl.h>
#include <time.h>
#include <grp.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/wait.h>
#include <unistd.h>
static void measured(int fd,const char *name){
 char buffer[8192];
 char path[128];snprintf(path,sizeof path,"/proc/self/fd/%d/%s",fd,name);
 FILE *file=fopen(path,"re");size_t size=0;
 if(file){size=fread(buffer,1,sizeof buffer-1,file);fclose(file);}
 buffer[size]=0;hf_json_write_string(stdout,buffer);
}
static int event_seen(int fd,const char *name,const char *key){
 int raw=openat(fd,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);if(raw<0)return 0;FILE *file=fdopen(raw,"r");if(!file){close(raw);return 0;}char line[256],field[128];unsigned long long value=0;int seen=0;
 while(fgets(line,sizeof line,file))if(sscanf(line,"%127s %llu",field,&value)==2&&!strcmp(field,key)&&value>0){seen=1;break;}fclose(file);return seen;
}
static void wait_enforcement(const HfBudgetHandle *h,const char *mode){
 struct timespec start,now;if(clock_gettime(CLOCK_MONOTONIC,&start))return;
 for(;;){if(event_seen(h->scope_fd,!strcmp(mode,"cpu")?"cpu.stat":"memory.events",!strcmp(mode,"cpu")?"nr_throttled":"oom_kill"))return;
  if(clock_gettime(CLOCK_MONOTONIC,&now)||now.tv_sec-start.tv_sec>=8)return;usleep(100000);}
}
static void run_child(const HfBudgetHandle *h,int ready,int command,const char *mode){
 pid_t expected_parent=getppid();
 gid_t extra_group=65533;
 if(setpgid(0,0)||(!strcmp(mode,"extra-group")?setgroups(1,&extra_group):setgroups(0,NULL))||setgid(h->slot_gid)||setuid(h->slot_uid)||(!strcmp(mode,"no-new-privs")?0:prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)))_exit(91);
 if(prctl(PR_SET_PDEATHSIG,SIGKILL,0,0,0)||getppid()!=expected_parent)_exit(96);
 char byte='R';if(write(ready,&byte,1)!=1||read(command,&byte,1)!=1)_exit(92);
 close(ready);close(command);
 if(!strcmp(mode,"cpu")){
  pid_t expected_parent=getpid();pid_t descendant=fork();if(descendant<0)_exit(93);
  if(descendant==0&&(prctl(PR_SET_PDEATHSIG,SIGKILL,0,0,0)||getppid()!=expected_parent))_exit(97);
  volatile unsigned long value=0;for(;;)value++;
 }else if(!strcmp(mode,"memory")){
  size_t size=(size_t)h->memory_bytes*3;volatile unsigned char *data=malloc(size);
  if(!data)_exit(94);
  for(size_t at=0;at<size;at+=4096)data[at]=1;
 }
 for(;;)pause();
}
int main(int argc,char **argv){
 if(argc!=4)return 2;
 char *charge=NULL;size_t length=0;
 if(!hf_private_read(argv[2],65536,&charge,&length))return 3;
 HfBudgetHandle h;int prepared=hf_budget_prepare(argv[1],charge,&h);free(charge);
 printf("{\"prepare_code\":%d,\"prepare\":",prepared);hf_budget_observe(&h,stdout);
 int attached=-2;pid_t child=-1;int control[2]={-1,-1},ready[2]={-1,-1};int waited=0,oom=0,live_release=-2;
 if(prepared==HF_BUDGET_READY&&strcmp(argv[3],"prepare")){
  if(prctl(PR_SET_CHILD_SUBREAPER,1,0,0,0)||pipe(control)||pipe(ready))return 4;
  child=fork();
  if(child==0){close(control[1]);close(ready[0]);run_child(&h,ready[1],control[0],argv[3]);_exit(95);}
  if(child<0)return 5;
  close(control[0]);close(ready[1]);char byte=0;HfProcessIdentity identity;
  if(read(ready[0],&byte,1)==1&&byte=='R'&&hf_process_identity(child,&identity)){
   if(!strcmp(argv[3],"wrong-start"))identity.start_time++;
   attached=hf_budget_attach(&h,&identity);
   if(attached==HF_BUDGET_READY){byte='G';if(write(control[1],&byte,1)!=1)return 6;wait_enforcement(&h,argv[3]);}
  }
  close(ready[0]);close(control[1]);
 }
 if(attached==HF_BUDGET_READY&&!strcmp(argv[3],"cpu"))live_release=hf_budget_release(&h);
 printf(",\"attach_code\":%d,\"live_release_code\":%d,\"during\":",attached,live_release);hf_budget_observe(&h,stdout);
 fputs(",\"cpu_stat\":",stdout);measured(h.scope_fd,"cpu.stat");
 fputs(",\"memory_events\":",stdout);measured(h.scope_fd,"memory.events");
 if(child>0){
  if(kill(-child,SIGKILL)&&errno!=ESRCH)return 7;
  if(kill(child,SIGKILL)&&errno!=ESRCH)return 8;
  for(;;){int status=0;pid_t pid=waitpid(-1,&status,0);if(pid<0){if(errno==EINTR)continue;if(errno!=ECHILD)return 9;break;}waited++;if(WIFSIGNALED(status)&&WTERMSIG(status)==SIGKILL)oom++;}
 }
 int released=hf_budget_release(&h);
 printf(",\"release_code\":%d,\"waited_children\":%d,\"sigkill_observations\":%d,\"authority\":\"NONE\",\"signed_charge_qualification\":\"NOT_EVALUATED\"}\n",released,waited,oom);
 return 0;
}
"""
def uid():return str(uuid.uuid4())
def check(value,message):
    if not value:raise AssertionError(message)
def kernel_parent():
    membership=next((line[3:] for line in Path("/proc/self/cgroup").read_text().splitlines() if line.startswith("0::")),None)
    def decode(value):
        import re
        return re.sub(r"\\([0-7]{3})",lambda m:chr(int(m[1],8)),value)
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        left,right=line.split(" - ",1)
        if right.split()[0]!="cgroup2":continue
        fields=left.split();mounted,point=decode(fields[3]),Path(decode(fields[4]))
        if membership is None or not(membership==mounted or membership.startswith(mounted.rstrip("/")+"/")):continue
        current=point/membership[len(mounted):].lstrip("/")
        parent=current.parent
        if parent!=point and point not in parent.parents:continue
        if not {"cpu","memory"}.issubset(set((parent/"cgroup.subtree_control").read_text().split())):continue
        return parent
    return None
class BudgetFixture:
    def __init__(self):
        self.temp=tempfile.TemporaryDirectory(prefix="runner-budget-",dir="/tmp/hyperfide")
        self.path=Path(self.temp.name);self.delegated=None
        source=self.path/"driver.c";source.write_text(DRIVER)
        self.binary=self.path/"budget-probe"
        command=["cc","-std=c11","-O1","-ffunction-sections","-fdata-sections","-I",str(ROOT/"src/hyperfide"),str(source),str(ROOT/"src/hyperfide/budget.c"),str(ROOT/"src/hyperfide/supervisor.c"),str(ROOT/"src/hyperfide/transport.c"),"-Wl,--gc-sections","-lcurl","-lcrypto","-lsqlite3","-o",str(self.binary)]
        built=subprocess.run(command,cwd=ROOT,capture_output=True,text=True)
        check(built.returncode==0,"Actual budget helper build failed: "+built.stderr[:3000])
        self.scope={"organisation_id":uid(),"run_id":uid(),"sandbox_id":uid(),"boot_id":uid(),"boot_generation":"1"}
        self.slot=uid()
        self.config={"schema_version":1,"backend":"cgroup-v2",**self.scope,"delegated_root":str(self.path),"cpu_controller":"cpu","memory_controller":"memory","slots":[{"slot_id":self.slot,"uid":65534,"gid":65534}],"disk_quota":None}
        self.charge={"charge":{"charge_id":uid(),"generation":"1","request_id":uid(),"organisation_id":self.scope["organisation_id"],"run_id":self.scope["run_id"],"sandbox_id":self.scope["sandbox_id"],"sandbox_boot_generation":"1","slot_id":self.slot,"attempt_id":None,"job_kind":"PREPARATION","resources":{"cpu_millis":"100","memory_bytes":str(32*1024*1024),"disk_bytes":"0"},"usable_limits":{"cpu_millis":"2000","memory_bytes":str(128*1024*1024),"disk_bytes":str(1024*1024*1024)},"qualification_id":uid(),"evidence_digest":"sha256:"+"1"*64},"boot_id":self.scope["boot_id"],"uid":65534,"gid":65534}
    def invoke(self,*,config=None,charge=None,mode="prepare",permissions=0o600,symlink=False):
        c=self.path/("config-"+uid()+".json");q=self.path/("charge-"+uid()+".json")
        c.write_text(json.dumps(self.config if config is None else config));c.chmod(permissions)
        q.write_text(json.dumps(self.charge if charge is None else charge));q.chmod(0o600)
        if symlink:
            link=self.path/("link-"+uid()+".json");link.symlink_to(c);c=link
        result=subprocess.run([str(self.binary),str(c),str(q),mode],capture_output=True,text=True,timeout=20)
        check(result.returncode==0,"Actual kernel budget process failed: "+result.stderr[:1000]+" "+result.stdout[:1000])
        return json.loads(result.stdout)
    def enable_isolated_delegation(self):
        if os.geteuid()!=0:return {"available":False,"reason":"ROOT_UNAVAILABLE"}
        parent=kernel_parent()
        if parent is None:return {"available":False,"reason":"NO_OBSERVED_PARENT_CONTROLLERS"}
        target=parent/("hf-budget-qualification-"+uid())
        try:
            target.mkdir(mode=0o700);self.delegated=target
            (target/"cpu.max").write_text("200000 100000\n")
            (target/"memory.max").write_text(str(128*1024*1024)+"\n")
            if (target/"memory.swap.max").exists():(target/"memory.swap.max").write_text("0\n")
            (target/"cgroup.subtree_control").write_text("+cpu +memory\n")
            check({"cpu","memory"}.issubset(set((target/"cgroup.subtree_control").read_text().split())),"Actual controller delegation did not read back")
            self.config["delegated_root"]=str(target)
            return {"available":True,"path":str(target)}
        except OSError as error:return {"available":False,"reason":error.__class__.__name__,"errno":error.errno}
    def close(self):
        if self.delegated is not None:
            check(not list(self.delegated.glob("hf-*")),"Actual charge cgroups remain; cleanup debt must not be hidden")
            self.delegated.rmdir();self.delegated=None
        self.temp.cleanup()
def run():
    fixture=BudgetFixture();observations=[]
    try:
        result=fixture.invoke()
        check(result["prepare_code"]==0 and not result["prepare"]["cpu_enforced"] and not result["prepare"]["memory_enforced"],"Ordinary filesystem substituted for cgroup enforcement")
        observations.append({"id":"budget.non-cgroup-refused","observed":True})
        for name,config,charge in (
            ("scope",None,dict(fixture.charge,boot_id=uid())),
            ("resource-vector",None,{**fixture.charge,"charge":{**fixture.charge["charge"],"resources":{**fixture.charge["charge"]["resources"],"memory_bytes":str(1024*1024*1024)}}}),
            ("duplicate-slot",{**fixture.config,"slots":fixture.config["slots"]*2},None),
            ("duplicate-uid",{**fixture.config,"slots":[*fixture.config["slots"],{**fixture.config["slots"][0],"slot_id":uid()}]},None),
            ("private-config-mode",None,None),
            ("private-config-symlink",None,None)):
            result=fixture.invoke(config=config,charge=charge,permissions=0o640 if name=="private-config-mode" else 0o600,symlink=name=="private-config-symlink")
            check(result["prepare_code"]==-1,"Actual hostile input was not refused: "+name)
            observations.append({"id":"budget."+name+"-refused","observed":True})
        capability=fixture.enable_isolated_delegation()
        if not capability["available"]:
            return {"scope":"kernel-budget-primitive","observations":observations,"kernel_enforcement":"UNAVAILABLE","capability":capability,"native_claim_integration":"NOT_QUALIFIED","signed_charge_authentication":"NOT_EVALUATED"}
        no_new_privs=next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines() if line.startswith("NoNewPrivs:"))
        modes=("wrong-start","extra-group",*(("no-new-privs",) if no_new_privs=="0" else ()),"cpu","memory")
        if no_new_privs!="0":observations.append({"id":"budget.no-new-privs-refusal","observed":False,"reason":"INHERITED_KERNEL_NO_NEW_PRIVS_CANNOT_BE_UNSET"})
        for mode in modes:
            fixture.charge["charge"]["charge_id"]=uid()
            result=fixture.invoke(mode=mode)
            check(result["prepare_code"]==1 and result["prepare"]["cpu_enforced"] and result["prepare"]["memory_enforced"],"Actual CPU/memory kernel limits unavailable: "+json.dumps(result))
            check(result["release_code"]==1,"Fresh charge cgroup removal not confirmed")
            if mode in ("wrong-start","extra-group","no-new-privs"):
                check(result["attach_code"]==-1 and result["during"]["process"] is None,"Invalid kernel identity or privilege state attached: "+mode+" "+json.dumps(result))
            else:
                check(result["attach_code"]==1,"Actual gated child did not attach")
                if mode=="cpu":check(result["live_release_code"]==-1,"Populated actual cgroup released while child tree lived")
                stats={line.split()[0]:int(line.split()[1]) for line in result["cpu_stat" if mode=="cpu" else "memory_events"].splitlines() if len(line.split())==2}
                check(stats.get("nr_throttled" if mode=="cpu" else "oom_kill",0)>0,"Actual aggregate kernel enforcement was not observed: "+json.dumps(result))
            observations.append({"id":"budget.actual-kernel-"+mode,"observed":True,"result":result})
        fixture.charge["charge"]["charge_id"]=uid()
        fixture.charge["charge"]["resources"]["disk_bytes"]="1"
        result=fixture.invoke()
        check(result["prepare_code"]==0 and result["prepare"]["cpu_enforced"] and result["prepare"]["memory_enforced"] and not result["prepare"]["disk_enforced"] and result["prepare"]["reason"]=="DISK_QUOTA_UNAVAILABLE" and result["release_code"]==1,"Unproven disk quota became READY or hid cleanup")
        observations.append({"id":"budget.unproven-disk-unavailable","observed":True,"result":result})
        return {"scope":"kernel-budget-primitive","observations":observations,"kernel_enforcement":"CPU_MEMORY_OBSERVED","disk_enforcement":"UNAVAILABLE","native_claim_integration":"NOT_QUALIFIED","signed_charge_authentication":"NOT_EVALUATED"}
    finally:fixture.close()
if __name__=="__main__":
    result=run();print(json.dumps(result),flush=True)
    raise SystemExit(77 if result["kernel_enforcement"]=="UNAVAILABLE" else 0)
