#!/usr/bin/env bash
# Construct a nonpublishing, checksummed Hyperfide release on a remote executor.
# Usage: scripts/release.sh --output DIR [--skip-tests]
# Publication destinations are operator configuration; this script never publishes.
set -euo pipefail
cd "$(dirname "$0")/.."
output=""
run_tests=1
while [ "$#" -gt 0 ]; do
 case "$1" in
  --output) [ "$#" -ge 2 ] || exit 2; output="$2"; shift 2 ;;
  --skip-tests) run_tests=0; shift ;;
  *) echo "usage: scripts/release.sh --output DIR [--skip-tests]" >&2; exit 2 ;;
 esac
done
[ -n "$output" ] || { echo "hyperfide release: --output is required" >&2; exit 2; }
[ -z "$(git status --porcelain --untracked-files=normal)" ] || { echo "hyperfide release: source checkout must be committed and clean" >&2; exit 2; }
case "${HYPERFIDE_BUILD_PLACEMENT:-}" in
 remote) ;;
 *) echo "hyperfide release: HYPERFIDE_BUILD_PLACEMENT=remote is required by the supervision-only placement contract" >&2; exit 2 ;;
esac
make -j "${HYPERFIDE_BUILD_JOBS:-2}" all hyperfide-native
[ -x ./hyperfide ] || { echo "hyperfide release: canonical native artifact is missing" >&2; exit 1; }
[ "$(./hyperfide --version)" = "2.0.0-dev" ] || { echo "hyperfide release: unsupported development release identity" >&2; exit 1; }
if [ "$run_tests" -eq 1 ]; then make -j1 test; fi
python3 - "$output" "$run_tests" <<'PY'
from pathlib import Path
import gzip,hashlib,json,os,re,shutil,stat,subprocess,sys,tarfile,tempfile
root=Path.cwd();output=Path(sys.argv[1]).resolve();output.mkdir(parents=True,exist_ok=True)
def run(*args,**kw):return subprocess.check_output(args,text=True,**kw).strip()
def digest(p):return 'sha256:'+hashlib.sha256(p.read_bytes()).hexdigest()
def copy_file(source,target,mode=None):
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target);target.chmod(mode if mode else (0o755 if source.stat().st_mode&0o111 else 0o644))
node=Path(shutil.which('node')).resolve()
if run(str(node),'--version')!='v24.22.0' or run('npm','--version')!='11.19.1':raise SystemExit('hyperfide release: pinned Node/npm toolchain is required')
if sys.platform!='linux' or os.uname().machine!='x86_64':raise SystemExit('hyperfide release: supported release profile is Linux x64')
if sys.version_info[:3]!=(3,14,8):raise SystemExit('hyperfide release: Python3.14.8 is required for the qualified subreaper runtime')
python_prefix=Path(sys.base_prefix).resolve()
commit=run('git','rev-parse','HEAD');epoch=run('git','show','-s','--format=%ct','HEAD')
with tempfile.TemporaryDirectory(prefix='hyperfide-release-build-') as temporary:
 temp=Path(temporary);build=temp/'services';build.mkdir()
 for name in ['package.json','package-lock.json','tsconfig.json']:copy_file(root/'services/hyperfide'/name,build/name)
 shutil.copytree(root/'services/hyperfide/src',build/'src')
 subprocess.run(['npm','ci','--ignore-scripts'],cwd=build,check=True)
 subprocess.run(['npm','run','check'],cwd=build,check=True)
 subprocess.run(['npm','run','build'],cwd=build,check=True)
 stage=temp/'release';stage.mkdir()
 copy_file(root/'hyperfide',stage/'bin/hyperfide',0o755)
 copy_file(root/'hyperfide',stage/'bin/cg',0o755)
 copy_file(root/'build/hyperfide-native',stage/'bin/hyperfide-native',0o755)
 copy_file(node,stage/'runtime/node',0o755)
 python_stage=stage/'runtime/python';python_stage.mkdir(parents=True)
 copy_file(Path(sys.executable).resolve(),python_stage/'bin/python3.bin',0o755)
 copy_file(root/'scripts/hyperfide-python.sh',python_stage/'bin/python3',0o755)
 stdlib=python_prefix/'lib/python3.14'
 if not(stdlib/'ctypes/__init__.py').is_file():raise SystemExit('hyperfide release: complete Python ctypes standard library is required')
 shutil.copytree(stdlib,python_stage/'lib/python3.14',ignore=shutil.ignore_patterns('site-packages','__pycache__','test','tests'))
 for library in sorted((python_prefix/'lib').glob('libpython3.14*.so*')):
  copy_file(library.resolve(),python_stage/'lib'/library.name,0o755)

 for name in ['install.sh','uninstall.sh','hyperfide-entrypoint.sh','hyperfide-python.sh']:copy_file(root/'scripts'/name,stage/'scripts'/name,0o755)
 for name in ['package.json','package-lock.json']:copy_file(build/name,stage/'services'/name)
 shutil.copytree(build/'dist',stage/'services/dist')
 shutil.copytree(root/'services/hyperfide/components',stage/'services/components')
 migrations=root/'services/hyperfide/migrations'
 if migrations.exists():shutil.copytree(migrations,stage/'services/migrations')
 subprocess.run(['npm','ci','--omit=dev','--ignore-scripts'],cwd=stage/'services',check=True)
 # Bundle the actual linked dependencies instead of replacing qualified link flags.
 executables=[(root/'hyperfide',stage/'lib/hyperfide'),(root/'build/hyperfide-native',stage/'lib/hyperfide'),(node,stage/'lib/hyperfide')]+[(item,python_stage/'lib') for item in [Path(sys.executable).resolve()]+sorted((stdlib/'lib-dynload').glob('*.so'))]
 for executable,library_root in executables:
  observed=subprocess.run(['ldd',str(executable)],text=True,capture_output=True)
  if observed.returncode:raise SystemExit('hyperfide release: cannot enumerate native runtime dependencies')
  if 'not found' in observed.stdout:raise SystemExit('hyperfide release: unresolved native runtime dependency')
  for raw in re.findall(r'(?:=>\s+|^\s*)(/[^\s()]+)',observed.stdout,re.M):
   source=Path(raw);target=library_root/source.name
   if target.exists() and digest(target)!=digest(source):raise SystemExit('hyperfide release: library name collision')
   copy_file(source,target,0o755)
 # npm's executable symlinks become ordinary pinned files in the release contract.
 for item in sorted(stage.rglob('*')):
  if item.is_symlink():
   target=item.resolve()
   if not target.is_file() or not target.is_relative_to(stage):raise SystemExit('hyperfide release: unsafe package link')
   data=target.read_bytes();mode=0o755 if target.stat().st_mode&0o111 else 0o644
   item.unlink();item.write_bytes(data);item.chmod(mode)
 probe_env=dict(os.environ,PYTHONHOME=str(python_stage),LD_LIBRARY_PATH=str(stage/'lib/hyperfide'))
 probe_code="import ctypes,os,sys; assert sys.version_info[:3]==(3,14,8); assert os.path.realpath(sys.base_prefix)==os.path.realpath(sys.argv[1]); libc=ctypes.CDLL(None,use_errno=True); value=ctypes.c_int(); assert libc.prctl(36,1,0,0,0)==0; assert libc.prctl(37,ctypes.byref(value),0,0,0)==0 and value.value==1; assert os.access('/proc/self/task/'+str(os.getpid())+'/children',os.R_OK); child=os.fork(); os._exit(0) if child==0 else None; assert os.waitpid(child,0)[0]==child"
 subprocess.run([str(python_stage/'bin/python3'),'-I','-c',probe_code,str(python_stage)],env=probe_env,check=True)
 files=[]
 for item in sorted(stage.rglob('*')):
  if item.is_file():
   mode='0755' if item.stat().st_mode&0o111 else '0644';item.chmod(int(mode,8))
   files.append({'path':item.relative_to(stage).as_posix(),'digest':digest(item),'size_bytes':str(item.stat().st_size),'mode':mode})
 manifest={'schema_version':1,'release_version':'2.0.0-dev','source_commit':commit,'source_date_epoch':epoch,'protocol_version':1,'schema_min':1,'schema_max':1,'runtime':{'node':'24.22.0','npm':'11.19.1','python':'3.14.8','platform':'linux','architecture':'x64'},'files':files}
 encoded=(json.dumps(manifest,sort_keys=True,separators=(',',':'))+'\n').encode()
 (stage/'manifest.json').write_bytes(encoded)
 manifest_digest=hashlib.sha256(encoded).hexdigest();name='hyperfide-2.0.0-dev-linux-x64-'+manifest_digest[:16]+'.tar.gz'
 archive=output/name
 with archive.open('wb') as raw:
  with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=int(epoch)) as zipped:
   with tarfile.open(fileobj=zipped,mode='w',format=tarfile.GNU_FORMAT) as tar:
    for item in sorted(stage.rglob('*')):
     relative=item.relative_to(stage).as_posix();info=tar.gettarinfo(str(item),arcname=relative)
     info.uid=info.gid=0;info.uname=info.gname='';info.mtime=int(epoch)
     if info.isfile():
      with item.open('rb') as data:tar.addfile(info,data)
     elif info.isdir():tar.addfile(info)
     else:raise SystemExit('hyperfide release: unsupported artifact member')
 index={'schema_version':1,'release_version':manifest['release_version'],'manifest_digest':'sha256:'+manifest_digest,'archive':name,'archive_digest':digest(archive)}
 (output/'manifest.json').write_bytes(encoded)
 (output/'release.json').write_text(json.dumps(index,sort_keys=True)+'\n')
 shutil.copyfile(root/'scripts/install.sh',output/'install')
 shutil.copyfile(root/'scripts/uninstall.sh',output/'uninstall')
 print(json.dumps({'constructed':True,'published':False,'deployment_authorized':False,'source_commit':commit,'manifest_digest':index['manifest_digest'],'files':len(files),'tests_run':bool(int(sys.argv[2])),'output':str(output)}))
PY
