#!/usr/bin/env bash
# Remove only the recorded Hyperfide installation; project/native session data survives.
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import fcntl,json,os,shutil
def die(message):raise SystemExit('hyperfide uninstall: '+message)
a=os.environ.get('HYPERFIDE_INSTALL_DIR');b=os.environ.get('CODIFY_INSTALL_DIR')
if a is not None and b is not None and a!=b:die('conflicting installation directory aliases (values redacted)')
directory=Path(a if a is not None else b if b is not None else str(Path.home()/'.local/bin')).expanduser().resolve()
state=directory.parent/'lib/hyperfide';record=state/'receipt.json'
if state.is_symlink() or state.parent.is_symlink() or record.is_symlink() or not record.is_file():die('no ordinary owned installation receipt at the selected prefix')
lock_fd=os.open(state/'install.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
with os.fdopen(lock_fd,'a+b') as lock:
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:die('another installer owns this prefix')
 receipt=json.loads(record.read_text())
 if receipt.get('owner')!='hyperfide-installer' or receipt.get('command_directory')!=str(directory) or receipt.get('state_directory')!=str(state) or receipt.get('commands')!=['hyperfide','cg']:die('invalid installation ownership receipt')
 release=Path(receipt['release_directory'])
 if release.is_symlink() or release.parent.is_symlink() or release.parent!=state/'releases' or release.name!=receipt['manifest_digest'].removeprefix('sha256:'):die('release location differs from its identity')
 for name in receipt['commands']:
  item=directory/name
  if not item.is_symlink() or os.readlink(item)!=str(state/'current/bin'/name):die('a command was changed by its owner; nothing removed')
 current=state/'current'
 if not current.is_symlink() or current.resolve()!=release:die('active release changed; nothing removed')
 for name in receipt['commands']:(directory/name).unlink()
 current.unlink();record.unlink()
 # Previous releases and explicit legacy backups are retained for recovery.
 shutil.rmtree(release)
 print(json.dumps({'uninstalled':True,'commands':['hyperfide','cg'],'project_data_preserved':True,'native_auth_preserved':True,'previous_releases_and_backups_retained':True}))
PY
