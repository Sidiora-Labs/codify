#!/usr/bin/env python3
"""Actual registered capability boundary, with generated local image containers."""
import base64,copy,hashlib,importlib.util,json,struct,sys,tempfile,zlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
s=importlib.util.spec_from_file_location("decision_adapter_probe",Path(__file__).with_name("20_1.py"))
shared=importlib.util.module_from_spec(s);s.loader.exec_module(shared)
IDS=["decision.capability.default-disabled","decision.capability.span-off","decision.capability.span-on",
"decision.capability.zero-forbidden","decision.capability.deadline-bound","decision.capability.unsupported-reasoning",
"decision.capability.span-images","decision.capability.jev-assets","decision.capability.gateway-parts",
"decision.capability.gateway-unqualified","decision.capability.jev-dimensions","decision.capability.unreferenced-asset",
"decision.capability.duplicate-image","decision.capability.remote-image","decision.capability.truncated-image",
"decision.capability.image-count","decision.capability.context-budget","decision.capability.body-budget",
"decision.capability.long-context","decision.capability.header-forwarding","decision.capability.number-on",
"decision.capability.box-presence","decision.capability.liquid-repeated","decision.capability.jev-unknown",
"decision.capability.qualified-shared","decision.capability.observed-separate","decision.capability.unknown-price",
"decision.capability.selfhost-default","decision.capability.expanded-references","decision.capability.profile-not-wire","decision.capability.question-id-context",
"decision.capability.output-price"]
ACTIONS=["decision.capabilities.prepare","decision.capabilities.billing"]
def png(width=280,height=280):
 def chunk(k,b):return struct.pack(">I",len(b))+k+b+struct.pack(">I",zlib.crc32(k+b)&0xffffffff)
 raw=b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",width,height,8,2,0,0,0))+chunk(b"IDAT",zlib.compress((b"\0"+b"\0"*(width*3))*height))+chunk(b"IEND",b"")
 return "data:image/png;base64,"+base64.b64encode(raw).decode()
def profile(route="span-native"):
 return {"qualification_ref":"synthetic-capability-fixture-not-live","mode":"fixture","extensions":[],"images":False,
 "image_token_reserve":2048,"max_images":4,"max_image_bytes":1024*1024,"max_request_bytes":1024*1024,"max_question_bytes":65536,
 "context_request_tokens":64000,"context_question_tokens":32000,"tokenizer_ref":"synthetic-byte-bound-v1",
 "billing":"repeated-state"if route in ("ultra-native","span-selfhost")else"unknown",
 "price_input_per_million":.042 if route=="ultra-native"else None,"price_output_per_million":0}
def main():
 failed=[]
 with tempfile.TemporaryDirectory(prefix="hf20-capabilities-")as temp:
  f=shared.Fixture(temp,"20.3",ACTIONS)
  (f.components/"20.1.json").write_bytes((ROOT/"services/hyperfide/components/20.1.json").read_bytes())
  def check(i,fn):
   try:fn();actual="observed"
   except Exception as e:actual=f"{type(e).__name__}: {e}";failed.append(i)
   print(json.dumps({"type":"assertion","id":i,"expected":"observed","actual":actual}),flush=True)
  def invoke(inp,p=None,route=None,action=ACTIONS[0]):
   r=route or inp.get("route_id","span-native")
   env={}if p is False else {"HYPERFIDE_DECISION_CAPABILITY_PROFILES":json.dumps({r:p or profile(r)})}
   return f.invoke(action,inp,env)
  def good(inp,p=None,route=None,action=ACTIONS[0]):
   cp,r=invoke(inp,p,route,action);shared.expect(cp.returncode==0 and r.get("ok")is True,f"expected success: {r} {cp.stderr}");return r["result"]
  def bad(inp,p=None,route=None):
   cp,r=invoke(inp,p,route);shared.expect(cp.returncode!=0 and r.get("ok")is False,f"unsafe request accepted: {r}")
  def req(route="span-native",**kw):return {"route_id":route,"request":{"state":"bounded synthetic source","questions":{"q":{"type":"noul","instructions":"Is target present?"}}},"timeout_ms":1000,**kw}
  def media(route="span-native",uri=None):
   r=req(route,media=[{"id":"fixtureImageA","data_uri":uri or png()}])
   if route=="jev-native":r["request"]["state"]="Inspect fixtureImageA"
   return r
  enabled=profile();enabled["images"]=True
  check(IDS[0],lambda:bad(req(),False))
  check(IDS[1],lambda:shared.expect(good(req())["prepared"]["body"]["reasoning"]=={"mode":"off"},"Hyperfide failed explicit off"))
  check(IDS[2],lambda:shared.expect(good(req(reasoning={"mode":"on","budget_ms":200}))["prepared"]["body"]["reasoning"]["budget_ms"]==200,"bounded on missing"))
  check(IDS[3],lambda:bad(req(reasoning={"mode":"on","budget_ms":0})))
  check(IDS[4],lambda:bad(req(timeout_ms=100,reasoning={"mode":"on","budget_ms":101})))
  check(IDS[5],lambda:bad(req("jev-native",reasoning={"mode":"on","budget_ms":100})))
  check(IDS[6],lambda:shared.expect("images"in good(media(),enabled)["prepared"]["body"],"Span image encoding missing"))
  def jev_assets():
   v=good(media("jev-native"),enabled);shared.expect("assets"in v["prepared"]["body"]and v["prepared"]["headers"]["TypeSafe-Danger-Zone-Images"]=="true","Jev assets/opt-in missing")
  check(IDS[7],jev_assets)
  def gateway():
   v=good(media("jev-openrouter"),enabled)["prepared"]["body"]
   shared.expect(isinstance(v["state"][0],str)and v["state"][1]["type"]=="image_url"and"images"not in v and"assets"not in v,"Gateway native fields leaked")
  check(IDS[8],gateway)
  check(IDS[9],lambda:bad(media("span-openrouter"),enabled))
  check(IDS[10],lambda:bad(media("jev-native",png(279,280)),enabled))
  r=media("jev-native");r["request"]["state"]="no image reference"
  check(IDS[11],lambda:bad(r,enabled))
  r=media();r["media"]*=2
  check(IDS[12],lambda:bad(r,enabled))
  check(IDS[13],lambda:bad(media(uri="https://example.invalid/image.png"),enabled))
  check(IDS[14],lambda:bad(media(uri="data:image/png;base64,aGVsbG8="),enabled))
  p=copy.deepcopy(enabled);p["max_images"]=0
  check(IDS[15],lambda:bad(media(),p))
  p=profile();p["context_request_tokens"]=5
  check(IDS[16],lambda:bad(req(),p))
  p=profile();p["max_request_bytes"]=10
  check(IDS[17],lambda:bad(req(),p))
  check(IDS[18],lambda:shared.expect(good(req("jev-native",long_context=True))["prepared"]["headers"]["TypeSafe-Danger-Zone-Long-Context"]=="true","native opt-in missing"))
  check(IDS[19],lambda:bad(req("jev-openrouter",long_context=True)))
  def number():
   p=profile();p["extensions"]=["number"];r=req(reasoning={"mode":"on","budget_ms":100});r["request"]["questions"]={"n":{"type":"number","instructions":"Count objects"}}
   shared.expect(good(r,p)["prepared"]["body"]["questions"]["n"]["type"]=="number","number missing")
   r.pop("reasoning");bad(r,p)
  check(IDS[20],number)
  def box():
   p=copy.deepcopy(enabled);p["extensions"]=["box"];r=media("jev-native");r["request"]["questions"]["b"]={"type":"box","instructions":"Locate target"}
   good(r,p);del r["request"]["questions"]["q"];bad(r,p)
  check(IDS[21],box)
  def bill(route="ultra-native",p=None,**kw):return good({"route_id":route,"questions":10,"state_tokens":10000,"question_tokens":0,**kw},p,route,ACTIONS[1])
  check(IDS[22],lambda:shared.expect(bill()["estimated_input_tokens"]==100000 and abs(bill()["estimated_usd"]-.0042)<1e-12,"repeated state cost wrong"))
  check(IDS[23],lambda:shared.expect(bill("jev-native")["estimated_input_tokens"]is None,"unqualified Jev shared billing invented"))
  def shared_batch():
   p=profile("jev-native");p["billing"]="shared-batch";shared.expect(bill("jev-native",p)["estimated_input_tokens"]==10000,"qualified shared accounting wrong")
  check(IDS[24],shared_batch)
  def observed():
   v=bill(observed_usage={"input_tokens":123,"output_tokens":0,"provenance":"synthetic-api"},observed_cost={"usd":.001,"provenance":"synthetic-api-not-invoice","reconciled":False})
   shared.expect(v["observed_usage"]["input_tokens"]==123 and v["estimated_input_tokens"]==100000 and v["observed_cost"]["reconciled"]is False and v["evidence_class"]=="untrusted-preview","observation overwritten by estimate or trusted")
  check(IDS[25],observed)
  check(IDS[26],lambda:shared.expect(bill("span-native")["estimated_usd"]is None and bill("span-native")["cost_class"]=="unknown","unknown cost changed to zero"))
  check(IDS[27],lambda:shared.expect(good(req("span-selfhost"))["metadata"]["reasoning_semantics"]["provider_default"]=="engine-specific-unqualified","hosted default copied to selfhost"))
  def expanded():
   r=media("jev-native");r["request"]["state"]="fixtureImageA fixtureImageA"
   v=good(r,enabled);one=len(base64.b64decode(r["media"][0]["data_uri"].split(",")[1]));shared.expect(v["metadata"]["expanded_image_bytes"]==2*one,"repeated references not counted")
  check(IDS[28],expanded)
  r=req();r["profile"]=enabled
  check(IDS[29],lambda:bad(r))
  def key_context():
   r=req();r["request"]["questions"]={("q"*120)+str(i):{"type":"noul","instructions":"x"}for i in range(20)}
   p=profile();p["context_request_tokens"]=2000;p["context_question_tokens"]=2000
   bad(r,p)
  check(IDS[30],key_context)
  def output_price():
   p=profile("ultra-native");p["price_output_per_million"]=.5
   v=bill("ultra-native",p);shared.expect(v["estimated_usd"]is None and v["cost_class"]=="unknown","unbounded paid output understated as input-only cost")
   v=bill("ultra-native",p,output_tokens_bound=2000);shared.expect(abs(v["estimated_usd"]-.0052)<1e-12 and v["cost_class"]=="estimated","bounded output cost wrong")
   p["price_output_per_million"]=None
   v=bill("ultra-native",p,output_tokens_bound=2000);shared.expect(v["estimated_usd"]is None and v["cost_class"]=="unknown","unknown output price changed to zero")
  check(IDS[31],output_price)
 print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
 return 1 if failed else 0
if __name__=="__main__":sys.exit(main())
