#!/usr/bin/env bash
# Hyperfide prebuilt artifact installer. No build or dependency installation runs here.
# HYPERFIDE_BASE_URL (legacy CODIFY_BASE_URL) selects a controlled release endpoint.
# HYPERFIDE_INSTALL_DIR (legacy CODIFY_INSTALL_DIR) selects the command directory.
set -euo pipefail
case "${1:-}" in
 -h|--help)
  cat <<'USAGE'
Hyperfide installer: installs a verified prebuilt Hyperfide release.
Commands installed: hyperfide (canonical) and cg (compatibility alias).
Environment:
  HYPERFIDE_BASE_URL                  controlled release endpoint (legacy CODIFY_BASE_URL)
  HYPERFIDE_INSTALL_DIR               command directory (legacy CODIFY_INSTALL_DIR)
  HYPERFIDE_TRUSTED_RELEASE_KEY_FILE  trusted Ed25519 release key
  HYPERFIDE_MANIFEST_SHA256           explicit release manifest pin
USAGE
  exit 0 ;;
esac
python3 - <<'PY'
from pathlib import Path,PurePosixPath
import fcntl,hashlib,json,os,re,shutil,stat,subprocess,sys,tarfile,tempfile,urllib.parse,urllib.request,uuid
def die(message):raise SystemExit('hyperfide install: '+message)
def alias(canonical,legacy,default=None):
 a=os.environ.get(canonical);b=os.environ.get(legacy)
 if a is not None and b is not None and a!=b:die('conflicting '+canonical+' / '+legacy+' (values redacted)')
 return a if a is not None else b if b is not None else default
def sha(data):return 'sha256:'+hashlib.sha256(data).hexdigest()
def strict_json(data):
 def pairs(items):
  result={}
  for key,value in items:
   if key in result:die('duplicate JSON field')
   result[key]=value
  return result
 try:return json.loads(data.decode('utf-8'),object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
 except (ValueError,UnicodeError):die('invalid strict JSON')
def authenticate_manifest(key_path,encoded,signature,descriptor):
 if not isinstance(descriptor,dict) or set(descriptor)!={'algorithm','file','key_fingerprint'} or descriptor['algorithm']!='ED25519' or descriptor['file']!='manifest.sig' or len(signature)!=64:die('a detached Ed25519 manifest signature is required')
 if not Path(key_path).is_absolute() or any(part in ['.','..'] for part in key_path.split('/')):die('trusted public key must be an exact absolute reference')
 parts=[part for part in key_path.split('/') if part];directory_fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  for part in parts[:-1]:
   next_fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory_fd);os.close(directory_fd);directory_fd=next_fd
   parent=os.fstat(directory_fd);sticky_root=parent.st_uid==0 and bool(parent.st_mode&stat.S_ISVTX)
   if parent.st_uid not in [0,os.geteuid()] or (parent.st_mode&0o022 and not sticky_root):die('trusted public key ancestors must be protected')
  fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory_fd)
 finally:os.close(directory_fd)
 try:
  before=os.fstat(fd)
  if not stat.S_ISREG(before.st_mode) or before.st_size>16384 or before.st_uid not in [0,os.geteuid()] or before.st_mode&0o022:die('trusted public key must be an ordinary protected file')
  key=os.read(fd,16385);after=os.fstat(fd)
  if (before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):die('trusted public key changed')
 finally:os.close(fd)
 verifier=Path('/usr/bin/openssl')
 if not verifier.is_file() or not os.access(verifier,os.X_OK):die('trusted OpenSSL signature verifier is required')
 with tempfile.TemporaryDirectory(prefix='hyperfide-signature-') as temporary:
  temporary=Path(temporary);public=temporary/'public.pem';public.write_bytes(key);public.chmod(0o600)
  manifest=temporary/'manifest.json';manifest.write_bytes(encoded)
  detached=temporary/'manifest.sig';detached.write_bytes(signature)
  exported=subprocess.run([str(verifier),'pkey','-pubin','-in',str(public),'-outform','DER'],capture_output=True,stdin=subprocess.DEVNULL,timeout=30)
  if exported.returncode or len(exported.stdout)!=44 or not exported.stdout.startswith(bytes.fromhex('302a300506032b6570032100')):die('trusted public key must be Ed25519')
  fingerprint=sha(exported.stdout)
  if descriptor['key_fingerprint']!=fingerprint:die('release signer differs from the trusted key')
  verified=subprocess.run([str(verifier),'pkeyutl','-verify','-pubin','-inkey',str(public),'-rawin','-in',str(manifest),'-sigfile',str(detached)],capture_output=True,stdin=subprocess.DEVNULL,timeout=30)
  if verified.returncode:die('release manifest signature verification failed')
 return {'mode':'ED25519','key_fingerprint':fingerprint}
def sync_path(path,directory=False):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|(os.O_DIRECTORY if directory else 0))
 try:os.fsync(fd)
 finally:os.close(fd)

base=alias('HYPERFIDE_BASE_URL','CODIFY_BASE_URL')
if not base:die('set HYPERFIDE_BASE_URL to the controlled release endpoint')
pin=os.environ.get('HYPERFIDE_MANIFEST_SHA256','')
if pin and not pin.startswith('sha256:'):pin='sha256:'+pin
if pin and not re.fullmatch(r'sha256:[0-9a-f]{64}',pin):die('invalid explicit manifest pin')
trusted_key=os.environ.get('HYPERFIDE_TRUSTED_RELEASE_KEY_FILE')
if not pin and not trusted_key:die('an explicit trusted release key or manifest pin is required')
url=urllib.parse.urlsplit(base)
if url.username or url.password or url.query or url.fragment:die('release endpoint must not contain credentials, query or fragment')
if url.scheme!='https' and not((pin or trusted_key) and (url.scheme=='file' or(url.scheme=='http' and url.hostname in ['127.0.0.1','localhost','::1']))):die('HTTPS or a pinned local fixture endpoint is required')
def fetch(name,maximum):
 with urllib.request.urlopen(base.rstrip('/')+'/'+name,timeout=60) as response:
  data=response.read(maximum+1)
  if len(data)>maximum:die('release artifact exceeds the declared installer bound')
  return data
index=strict_json(fetch('release.json',1048576))
index_keys={'schema_version','release_version','manifest_digest','archive','archive_digest'}
if not isinstance(index,dict) or set(index) not in [index_keys,index_keys|{'signature'}] or type(index['schema_version']) is not int or index['schema_version']!=1:die('unsupported download index')
if not re.fullmatch(r'hyperfide-[A-Za-z0-9._-]+\.tar\.gz',index['archive']):die('unsafe archive name')
if pin and pin!=index['manifest_digest']:die('release manifest differs from the operator pin')
authentication={'mode':'EXPLICIT_MANIFEST_PIN','key_fingerprint':None}
verified_manifest=None
if trusted_key:
 verified_manifest=fetch('manifest.json',16777216)
 if sha(verified_manifest)!=index['manifest_digest']:die('signed manifest checksum mismatch')
 authentication=authenticate_manifest(trusted_key,verified_manifest,fetch('manifest.sig',128),index.get('signature'))
archive=fetch(index['archive'],1073741824)
if sha(archive)!=index['archive_digest']:die('archive checksum mismatch')
directory=Path(alias('HYPERFIDE_INSTALL_DIR','CODIFY_INSTALL_DIR',str(Path.home()/'.local/bin'))).expanduser().resolve()
directory.mkdir(parents=True,exist_ok=True)
def secure_directory(path):
 if path.is_symlink() or(path.exists() and not path.is_dir()):die('installation state path is not an ordinary directory')
 path.mkdir(exist_ok=True)
 if path.stat().st_uid!=os.getuid():die('installation state directory belongs to another user')
secure_directory(directory.parent/'lib')
state=directory.parent/'lib/hyperfide';secure_directory(state);state.chmod(0o700)
lock_fd=os.open(state/'install.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
with os.fdopen(lock_fd,'a+b') as lock:
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:die('another installer owns this prefix')
 with tempfile.TemporaryDirectory(prefix='.hyperfide-stage-',dir=state) as temporary:
  temporary=Path(temporary);packed=temporary/'artifact.tar.gz';packed.write_bytes(archive);tree=temporary/'tree';tree.mkdir()
  with tarfile.open(packed,'r:gz') as tar:
   total=0;members=[];seen=set()
   for member in tar:
    name=member.name;p=PurePosixPath(name)
    if p.is_absolute() or '\\' in name or any(x in ['.','..',''] for x in name.split('/')):die('unsafe archive path')
    if not(member.isfile() or member.isdir()) or name in seen:die('unsupported or duplicate archive member')
    seen.add(name);members.append(member);total+=member.size
    if len(members)>200000 or total>4294967296 or member.size>1073741824:die('expanded artifact exceeds installer bounds')
   manifest_member=next((m for m in members if m.name=='manifest.json' and m.isfile()),None)
   if not manifest_member or manifest_member.size>16777216:die('archive has no bounded canonical manifest')
   encoded=tar.extractfile(manifest_member).read()
   if sha(encoded)!=index['manifest_digest']:die('manifest checksum mismatch')
   if verified_manifest is not None and encoded!=verified_manifest:die('archive differs from the signed exact manifest')
   manifest=strict_json(encoded)
   keys={'schema_version','release_version','source_commit','source_date_epoch','protocol_version','schema_min','schema_max','runtime','files'}
   if set(manifest)!=keys or manifest['schema_version']!=1 or manifest['release_version']!=index['release_version']:die('incompatible release manifest')
   if not isinstance(manifest['files'],list) or not manifest['files']:die('empty artifact inventory')
   files={}
   for entry in manifest['files']:
    if set(entry)!={'path','digest','size_bytes','mode'} or entry['mode'] not in ['0644','0755'] or not re.fullmatch(r'0|[1-9][0-9]*',entry['size_bytes']):die('invalid artifact record')
    if entry['path'] in files:die('duplicate artifact identity')
    files[entry['path']]=entry
   required={'bin/hyperfide','bin/cg','bin/hyperfide-native','runtime/node','runtime/python/bin/python3','runtime/python/bin/python3.bin','runtime/python/lib/python3.14/ctypes/__init__.py','services/dist/control.js','services/dist/provisioner.js','services/dist/dispatch.js','services/package-lock.json'}
   if not required<=files.keys():die('incomplete deployable release')
   if files['bin/hyperfide']['digest']!=files['bin/cg']['digest']:die('compatibility command is not the canonical implementation')
   if manifest['runtime']!={'node':'24.22.0','npm':'11.19.1','python':'3.14.8','platform':'linux','architecture':'x64'}:die('unsupported runtime profile')
   if os.uname().sysname!='Linux' or os.uname().machine!='x86_64':die('release is Linux x86_64 only')
   ordinary={m.name for m in members if m.isfile()}
   if ordinary!=set(files)|{'manifest.json'}:die('archive inventory differs from the canonical manifest')
   for member in members:
    target=tree/member.name
    if member.isdir():target.mkdir(parents=True,exist_ok=True);continue
    data=encoded if member.name=='manifest.json' else tar.extractfile(member).read()
    if member.name!='manifest.json':
     entry=files[member.name]
     if len(data)!=int(entry['size_bytes']) or sha(data)!=entry['digest']:die('artifact content mismatch')
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);target.chmod(0o644 if member.name=='manifest.json' else int(files[member.name]['mode'],8))
  # Resolve ownership before replacing any command. Unknown user executables survive.
  for name in ['hyperfide','cg']:
   target=directory/name;expected=str(state/'current/bin'/name)
   if target.is_symlink() and os.readlink(target)==expected:continue
   if target.exists() or target.is_symlink():
    legacy=os.environ.get('HYPERFIDE_LEGACY_CG_SHA256','')
    if name!='cg' or not target.is_file() or target.is_symlink() or not legacy or hashlib.sha256(target.read_bytes()).hexdigest()!=legacy.removeprefix('sha256:'):die('refusing to overwrite an unowned command: '+name)
    backup=state/'backups'/legacy.removeprefix('sha256:')/'cg';backup.parent.mkdir(parents=True,exist_ok=True)
    if backup.exists() and backup.read_bytes()!=target.read_bytes():die('legacy backup conflict')
    if not backup.exists():shutil.copyfile(target,backup);backup.chmod(0o700)
    sync_path(backup);sync_path(backup.parent,True)
  releases=state/'releases';secure_directory(releases)
  release=releases/index['manifest_digest'].split(':',1)[1]
  if release.is_symlink():die('release path must not be a symlink')
  if release.exists():
   if (release/'manifest.json').read_bytes()!=encoded:die('installed release identity conflict')
   for name,entry in files.items():
    installed=release/name
    if not installed.is_file() or installed.is_symlink() or installed.stat().st_mode&0o777!=int(entry['mode'],8) or sha(installed.read_bytes())!=entry['digest']:die('existing release has been modified')
  else:
   # Persist complete immutable bytes and directory entries before selecting the release.
   for ordinary in tree.rglob('*'):
    if ordinary.is_file():
     fd=os.open(ordinary,os.O_RDONLY|os.O_NOFOLLOW)
     try:os.fsync(fd)
     finally:os.close(fd)
   for folder in sorted([tree]+[x for x in tree.rglob('*') if x.is_dir()],key=lambda x:len(x.parts),reverse=True):
    fd=os.open(folder,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
   os.replace(tree,release)
  if (state/'current').exists() and not(state/'current').is_symlink():die('refusing unowned current release selector')
  current=state/('current.new-'+uuid.uuid4().hex);current.symlink_to(release);os.replace(current,state/'current')
  for name in ['hyperfide','cg']:
   link=directory/(name+'.new-'+uuid.uuid4().hex);link.symlink_to(state/'current/bin'/name);os.replace(link,directory/name)
  receipt={'schema_version':1,'owner':'hyperfide-installer','command_directory':str(directory),'state_directory':str(state),'release_directory':str(release),'manifest_digest':index['manifest_digest'],'commands':['hyperfide','cg'],'authentication':authentication}
  record=state/('receipt.new-'+uuid.uuid4().hex);record.write_text(json.dumps(receipt,sort_keys=True)+'\n');record.chmod(0o600);sync_path(record);os.replace(record,state/'receipt.json')
  for folder in [releases,state,directory]:sync_path(folder,True)
  print(json.dumps({'installed':True,'activated_services':False,'release_version':manifest['release_version'],'manifest_digest':index['manifest_digest'],'commands':['hyperfide','cg'],'command_directory':str(directory),'authentication':authentication}))
PY
