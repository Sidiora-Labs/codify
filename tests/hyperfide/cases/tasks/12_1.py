#!/usr/bin/env python3
"""Task 12.1 registered component probe: supervisor boots and isolated writable slots.

Drives the linked build/hyperfide-native runner against the actual task14.1
HTTPS/Ed25519/PostgreSQL service (IdentityFixture) over real sockets, plus real
slot allocation as root with temporary OS principals. Task-component scope only:
no provider, cloud, VM-qualification or full-case claim is made here.
"""
from __future__ import annotations
import base64, hashlib, http.client, json, os, pwd, re, secrets, shutil, signal, socket, ssl, subprocess, sys, tempfile, time, uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'tests/hyperfide/support'))
NATIVE = ROOT / 'build/hyperfide-native'
# Slot principals cannot traverse the supervisor's private toolchain; use the system interpreter.
SLOT_PYTHON = shutil.which('python3', path='/usr/bin:/bin') or '/usr/bin/python3'
FAILED = []
EVIDENCE = {}

def check(name, fn):
    try:
        fn(); actual = 'observed'
    except Exception as error:
        actual = type(error).__name__ + ': ' + str(error)[:1500]; FAILED.append(name)
    print(json.dumps({'type': 'assertion', 'id': name, 'expected': 'observed', 'actual': actual}), flush=True)

def expect(ok, message='unexpected outcome'):
    if not ok: raise AssertionError(message)

def uid(): return str(uuid.uuid4())
def sha(data): return 'sha256:' + hashlib.sha256(data).hexdigest()
def b64(data): return base64.urlsafe_b64encode(data).decode().rstrip('=')
def canonical(value): return json.dumps(value, separators=(',', ':'))
def private(path, value):
    path.write_text(value if isinstance(value, str) else canonical(value)); path.chmod(0o600)

# The runner process never receives database or fixture credentials.
RUNNER_ENV = {name: os.environ[name] for name in ('PATH', 'LANG', 'LC_ALL', 'TZ') if name in os.environ}

def native(action, request, timeout=60):
    result = subprocess.run([str(NATIVE), '--component', '12.1', '--action', action], input=canonical(request), env=RUNNER_ENV,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    body = json.loads(result.stdout) if result.stdout.strip() else None
    code = None
    match = re.search(r'hyperfide native: ([A-Z0-9_]+)', result.stderr)
    if match: code = match[1]
    return result.returncode, (body or {}).get('result'), code

def ok(action, request, **kw):
    rc, result, code = native(action, request, **kw)
    expect(rc == 0 and result is not None, action + ' refused: ' + str(code))
    return result

def refused(action, request, expected_code):
    rc, result, code = native(action, request)
    expect(rc != 0 and result is None, action + ' unexpectedly succeeded: ' + json.dumps(result)[:300])
    expect(code == expected_code, 'expected ' + expected_code + ' got ' + str(code))

def run(argv, **kw):
    return subprocess.run(argv, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=kw.pop('timeout', 120), **kw)

# ---------------------------------------------------------------- build/link contract
def build_contract_checks():
    script = ROOT / 'scripts/hyperfide-native-components.py'
    contract = {}
    def qualified():
        result = run(['python3', str(script), '--link-contract'])
        expect(result.returncode == 0, 'link contract failed: ' + result.stderr[:500])
        contract.update(json.loads(result.stdout))
        deps = contract['dependencies']
        expect(contract['status'] == 'PASS' and set(deps) >= {'curl', 'crypto'}, 'curl/crypto prerequisites undeclared')
        expect(tuple(map(int, deps['curl']['pkg_config_version'].split('.')[:2])) >= (7, 85), 'libcurl below 7.85')
        expect(tuple(map(int, deps['crypto']['pkg_config_version'].split('.')[:1])) >= (3,), 'OpenSSL below 3.0')
        expect('OpenSSL' in deps['curl']['tls_backends'] and deps['curl']['header_version'] == deps['curl']['pkg_config_version'], 'TLS backend/header pin mismatch')
        EVIDENCE['link_contract_dependencies'] = deps
    check('runner12.link-contract-qualified', qualified)
    def sources():
        listed = run(['python3', str(script), '--sources']).stdout.split()
        expect(listed == contract['sources'], 'source contract differs between outputs')
        expect('src/hyperfide/component_main.c' not in listed and not any(Path(p).name == 'component_main.c' for p in listed), 'standalone main leaked into contract')
        expect({'src/hyperfide/supervisor.c', 'src/hyperfide/transport.c', 'src/hyperfide/supervisor_daemon.c'} <= set(listed), '12.1 sources missing')
        expect({'-lcurl', '-lcrypto'} <= set(run(['python3', str(script), '--libraries']).stdout.split()), 'libcurl/libcrypto not exported')
    check('runner12.sources-exclude-standalone-main', sources)
    def registry():
        fragment = (ROOT / 'src/hyperfide/components/12.1.kvx').read_text()
        declared = json.loads(re.search(r'^actions = (\[.*\])$', fragment, re.M)[1])
        generated = (ROOT / 'build/hyperfide-native-registry.inc').read_text()
        linked = re.findall(r'\{"12\.1", "([^"]+)", hf_component_12_1\}', generated)
        expect(linked == declared, 'linked registry differs from fragment actions')
        expect([c['actions'] for c in contract['components'] if c['id'] == '12.1'] == [declared], 'contract actions differ')
        rc, _, _ = native('supervisor.unregistered', {})
        expect(rc != 0, 'unregistered action dispatched')
    check('runner12.registry-equals-fragment-actions', registry)
    def main_cli():
        dry = run(['make', '-n', '-B', 'hyperfide'], timeout=180)
        expect(dry.returncode == 0, 'main CLI dry-run failed: ' + dry.stderr[:300])
        for source in contract['sources']:
            expect(('-c -o build/' + source[len('src/'):-2] + '.o ' + source) in dry.stdout, 'main CLI omits ' + source)
        link = [line for line in dry.stdout.splitlines() if ' -o hyperfide ' in line]
        expect(len(link) == 1 and all(lib in link[0].split() for lib in contract['libraries']), 'main CLI link omits native libraries')
        expect('component_main' not in link[0], 'main CLI links standalone component main')
    check('runner12.main-cli-consumes-contract', main_cli)
    def runtime():
        described = ok('supervisor.describe', {})
        deps = contract['dependencies']
        expect(described['native_prerequisites_qualified'] is True and described['libcurl'] == deps['curl']['pkg_config_version'], 'runtime libcurl differs from build pin')
        expect(described['libcurl_headers'] == deps['curl']['header_version'] and described['tls_backend'].startswith('OpenSSL/'), 'header/TLS backend mismatch')
        expect(deps['crypto']['pkg_config_version'] in described['libcrypto'], 'runtime libcrypto differs from build pin')
        linked = run(['ldd', str(NATIVE)]).stdout
        expect('libcurl' in linked and 'libcrypto' in linked and 'libpq' not in linked, 'native link set unexpected')
        EVIDENCE['native_describe'] = described
    check('runner12.runtime-matches-link-contract', runtime)

# ---------------------------------------------------------------- 14.1 fixture
POLICY = {'schema_version': 1, 'programme_id': 'fixture-run', 'repository': 'fixture/repository', 'spec_revision': 'fixture-revision', 'policy_revision': 1}
PROFILE = dict(POLICY, supervisory_host_id='fixture-main', restrictions={'profile_digest': sha(b'restricted-native-profile'), 'evidence_digest': sha(b'contract-fixture'), 'qualification': 'QUALIFIED', 'expires_at': '2099-01-01T00:00:00.000Z'})
RUNNER_ACTIONS = ['identity.describe', 'identity.runner.register', 'identity.runner.heartbeat', 'identity.principal.renew', 'placement.authorize', 'placement.runner.authorize']

def setup(f):
    config = dict(PROFILE, programme_id=f.ids['run'], spec_revision='fixture-identity-v1')
    path = f.path / 'placement.json'; path.write_text(json.dumps(config)); f.env['HF_PLACEMENT_POLICY_FILE'] = str(path)
    f.sql("INSERT INTO hyperfide.event_consumers(organisation_id,run_id,id,consumer_key) VALUES($1,$2,$3,'placement-runner')", [f.ids['organisation'], f.ids['run'], uid()])

def certificate(folder, name, sans, ca=None):
    key, cert = folder / (name + '.key'), folder / (name + '.pem')
    if ca is None:
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-keyout', str(key), '-out', str(cert), '-subj', '/CN=' + name, '-addext', 'subjectAltName=' + sans, '-addext', 'basicConstraints=critical,CA:TRUE', '-days', '1'], check=True)
    else:
        csr = folder / (name + '.csr'); ext = folder / (name + '.ext'); ext.write_text('subjectAltName=' + sans + '\n')
        run(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key), '-out', str(csr), '-subj', '/CN=' + name], check=True)
        run(['openssl', 'x509', '-req', '-in', str(csr), '-CA', str(ca[1]), '-CAkey', str(ca[0]), '-CAcreateserial', '-out', str(cert), '-days', '1', '-sha256', '-extfile', str(ext)], check=True)
    key.chmod(0o600); cert.chmod(0o644)
    return key, cert

def users(count):
    created = []
    for index in range(count):
        name = 'hf12s' + secrets.token_hex(4) + str(index)
        result = run(['useradd', '--system', '--no-create-home', '--shell', '/usr/sbin/nologin', '--user-group', name])
        expect(result.returncode == 0, 'temporary slot principal creation failed: ' + result.stderr[:200])
        entry = pwd.getpwnam(name); created.append((name, entry.pw_uid, entry.pw_gid))
    return created

WORKER = r'''
import errno,json,os,socket,sys
mode=sys.argv[1];tag=sys.argv[2];env=os.environ
def out(value):print(json.dumps(value),flush=True)
if mode=="build":
    written={}
    for var,rel in (("XDG_CACHE_HOME","tool/cache.bin"),("XDG_CONFIG_HOME","tool/config"),("TMPDIR","build.o"),("HF_SLOT_BUILD","out.o"),("HOME",".toolrc")):
        path=os.path.join(env[var],rel);os.makedirs(os.path.dirname(path),exist_ok=True)
        with open(path,"w") as s:s.write(tag)
        written[var]=path
    server=socket.socket();server.bind(("127.0.0.1",int(env["HF_SLOT_PORT"])));server.listen()
    out({"ready":True,"written":written,"cwd":os.getcwd(),"uid":os.getuid()});sys.stdin.read();server.close()
elif mode=="default-port":
    server=socket.socket()
    try:server.bind(("127.0.0.1",int(sys.argv[3])));server.listen();out({"bound":True})
    except OSError as error:out({"bound":False,"errno":error.errno})
    sys.stdin.read()
elif mode=="cross":
    results={}
    for path in sys.argv[3:]:
        try:
            with open(path,"a") as s:s.write("intrusion")
            results[path]="written"
        except OSError as error:results[path]=errno.errorcode.get(error.errno,str(error.errno))
    out(results)
elif mode=="fill":
    accepted=os.path.join(env["HF_SLOT_BUILD"],"accepted-result.txt")
    with open(accepted,"w") as s:s.write(tag);s.flush();os.fsync(s.fileno())
    written=0;error=None
    try:
        with open(os.path.join(env["TMPDIR"],"fill.bin"),"wb") as s:
            while written<1<<30:
                s.write(b"\0"*65536);s.flush();written+=65536
            os.fsync(s.fileno())
    except OSError as failure:error=errno.errorcode.get(failure.errno,str(failure.errno))
    out({"written":written,"error":error})
elif mode=="write":
    path=os.path.join(env["HF_SLOT_BUILD"],"accepted-result.txt")
    with open(path,"w") as s:s.write(tag*1);s.flush();os.fsync(s.fileno())
    big=os.path.join(env["HF_SLOT_BUILD"],"artifact.bin")
    with open(big,"wb") as s:s.write(b"\1"*1048576);s.flush();os.fsync(s.fileno())
    out({"written":True})
'''

def as_slot(slot, mode, tag, *args, stdin=False):
    environment = dict(RUNNER_ENV, **slot['environment'])
    return subprocess.Popen([SLOT_PYTHON, '-I', '-c', WORKER, mode, tag, *map(str, args)], cwd=slot['paths']['worktree'], env=environment, user=slot['uid'], group=slot['gid'], extra_groups=[],
                            stdin=subprocess.PIPE if stdin else subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

def finished(process, timeout=60):
    out, err = process.communicate(timeout=timeout)
    expect(process.returncode == 0, 'slot worker failed: ' + err[:400])
    return json.loads(out.splitlines()[-1])

def https(f, body, headers, port=None):
    context = ssl.create_default_context(cafile=str(f.ca))
    connection = http.client.HTTPSConnection('localhost', port or f.port, context=context, timeout=10)
    try:
        connection.request('POST', '/v1/invoke', body.encode() if isinstance(body, str) else body, dict(headers, **{'Content-Type': 'application/json'}))
        response = connection.getresponse(); data = response.read()
        return response.status, json.loads(data) if data else None, data.decode(errors='replace')
    finally:
        connection.close()

def main():
    if os.geteuid() != 0:
        print(json.dumps({'type': 'assertion', 'id': 'runner12.root-required', 'expected': 'observed', 'actual': 'root required'}), flush=True)
        print(json.dumps({'type': 'cleanup', 'resources': [], 'complete': True}), flush=True)
        return 1
    build_contract_checks()
    import identity_fixture
    f = None; created = []; children = []; folder = tempfile.TemporaryDirectory(prefix='hf-runner12-'); work = Path(folder.name); work.chmod(0o700)
    slot_root = None
    denials = []
    try:
        f = identity_fixture.IdentityFixture(extra_components=('6.1', '1.1'), extra_setup=setup)
        expect(f.bind()[1].get('ok') is True, 'provider binding failed')
        keys = work / 'keys'; keys.mkdir(mode=0o700)
        transport = work / 'transport.json'; key_path = keys / 'runner.pem'; grant = keys / 'grant.json'

        def issue(grant_id, ttl=300):
            response = f.issue(grant=grant_id, ttl=ttl, actions=RUNNER_ACTIONS)[1]
            expect(response.get('ok') is True, 'grant issue failed: ' + json.dumps(response)[:300])

        def enrollment_payload(public_key, boot=None):
            return canonical({'run_id': f.ids['run'], 'provisioning_intent_id': f.ids['intent'], 'sandbox_id': f.ids['sandbox'], 'boot_generation': '1', 'boot_id': boot or f.ids['boot'], 'public_key_b64': public_key})

        def call(action, config, payload, **extra):
            request = {'config_path': str(config), 'payload_json': payload, 'operation_id': uid(), 'idempotency_key': uid(), 'correlation_id': uid()}
            request.update(extra)
            return ok(action, request)

        def describe_payload(component='14.1', action='identity.describe', input=None):
            return canonical({'run_id': f.ids['run'], 'component': component, 'action': action, 'input': input or {}, 'expected_version': None, 'authority': None})

        # ---------------------------------------------- enrollment / registration identity
        enrolled = {}
        def native_enroll():
            public = ok('supervisor.keygen', {'key_path': str(key_path)})['public_key_b64']
            issue(f.grant); private(grant, {'grant_id': f.grant, 'secret_b64': b64(f.secret)})
            private(transport, {'origin': f.origin, 'ca_file': str(f.ca), 'key_path': str(key_path), 'grant_path': str(grant), 'timeout_ms': 5000})
            result = call('supervisor.enroll', transport, enrollment_payload(public))
            expect(result['accepted'] is True and result['completed'] is True, 'native enrollment refused: ' + json.dumps(result)[:400])
            identity = result['response']['result']
            expect(identity['role'] == 'RUNNER' and identity['sandbox_id'] == f.ids['sandbox'] and identity['boot_id'] == f.ids['boot'] and identity['boot_generation'] == '1', 'server identity differs')
            config = json.loads(transport.read_text())
            expect(config['credential_id'] == identity['credential_id'] and 'grant_path' not in config and not grant.exists(), 'credential not persisted or grant retained')
            enrolled.update(identity); f.ids['runner'] = identity['credential_id']
        check('runner12.native-enroll-real-https', native_enroll)

        def signed_invoke():
            result = call('supervisor.invoke', transport, describe_payload())
            expect(result['accepted'] is True and result['response']['result']['principal']['credential_id'] == enrolled['credential_id'], 'signed invoke refused')
        check('runner12.native-signed-invoke', signed_invoke)

        def stale_grant():
            stale = uid(); issue(stale, ttl=1); time.sleep(2.2)
            stale_key = keys / 'stale.pem'; public = ok('supervisor.keygen', {'key_path': str(stale_key)})['public_key_b64']
            stale_grant_file = keys / 'stale-grant.json'; private(stale_grant_file, {'grant_id': stale, 'secret_b64': b64(f.secret)})
            config = work / 'stale-transport.json'; private(config, {'origin': f.origin, 'ca_file': str(f.ca), 'key_path': str(stale_key), 'grant_path': str(stale_grant_file), 'timeout_ms': 5000})
            result = call('supervisor.enroll', config, enrollment_payload(public)); denials.append(result)
            expect(result['accepted'] is False and result['completed'] is True and result['http_status'] in (401, 403), 'stale bootstrap token admitted: ' + json.dumps(result)[:300])
            expect(stale_grant_file.exists() and json.loads(config.read_text()).get('credential_id') is None, 'refused enrollment persisted state')
        check('runner12.stale-bootstrap-token-refused', stale_grant)

        def wrong_sandbox():
            other = uid(); issue(other)
            other_key = keys / 'wrong-boot.pem'; public = ok('supervisor.keygen', {'key_path': str(other_key)})['public_key_b64']
            other_grant = keys / 'wrong-boot-grant.json'; private(other_grant, {'grant_id': other, 'secret_b64': b64(f.secret)})
            config = work / 'wrong-boot-transport.json'; private(config, {'origin': f.origin, 'ca_file': str(f.ca), 'key_path': str(other_key), 'grant_path': str(other_grant), 'timeout_ms': 5000})
            result = call('supervisor.enroll', config, enrollment_payload(public, boot=uid())); denials.append(result)
            expect(result['accepted'] is False and result['http_status'] in (401, 403), 'wrong boot identity admitted: ' + json.dumps(result)[:300])
            state = f.sql('SELECT state FROM hyperfide.identity_enrollment_grants WHERE id=$1', [other])
            expect(state and state[0]['state'] == 'ISSUED', 'wrong identity consumed the grant')
        check('runner12.wrong-sandbox-identity-refused', wrong_sandbox)

        def forbidden_role():
            result = call('supervisor.invoke', transport, describe_payload(action='identity.grant.issue', input={'grant_id': uid(), 'provisioning_intent_id': f.ids['intent'], 'verifier': sha(b'x'), 'allowed_actions': ['identity.describe'], 'ttl_seconds': 60}))
            denials.append(result)
            expect(result['accepted'] is False and result['response'] and result['response'].get('ok') is False, 'runner performed a coordinator operation')
        check('runner12.forbidden-role-operation-refused', forbidden_role)

        # ---------------------------------------------- TLS endpoint identity over real sockets
        tls = work / 'tls'; tls.mkdir(mode=0o700)
        def wrong_certificate():
            _, rogue = certificate(tls, 'localhost', 'DNS:localhost,IP:127.0.0.1')
            config = work / 'rogue-transport.json'; settings = json.loads(transport.read_text()); settings['ca_file'] = str(rogue); private(config, settings)
            result = call('supervisor.invoke', config, describe_payload())
            expect(result['completed'] is False and result['accepted'] is False and result['error'] in ('HTTPS_TRANSPORT_60', 'HTTPS_TRANSPORT_35'), 'untrusted certificate accepted: ' + json.dumps(result)[:300])
        check('runner12.wrong-certificate-refused', wrong_certificate)

        def wrong_hostname():
            ca = certificate(tls, 'hf12-test-ca', 'DNS:hf12-test-ca.invalid')
            good = certificate(tls, 'good-leaf', 'DNS:localhost,IP:127.0.0.1', ca=ca)
            wrong = certificate(tls, 'wrong-leaf', 'DNS:wrong-host.invalid', ca=ca)
            config = work / 'ca2-transport.json'; settings = json.loads(transport.read_text()); settings['ca_file'] = str(ca[1]); private(config, settings)
            original = (f.ca, f.tlskey)
            try:
                f.stop(); f.ca, f.tlskey = good[1], good[0]; f.start()
                control = call('supervisor.invoke', config, describe_payload())
                expect(control['accepted'] is True, 'CA-signed matching host refused (control): ' + json.dumps(control)[:300])
                f.stop(); f.ca, f.tlskey = wrong[1], wrong[0]; f.start()
                result = call('supervisor.invoke', config, describe_payload())
                expect(result['completed'] is False and result['accepted'] is False and result['error'] == 'HTTPS_TRANSPORT_60', 'hostname mismatch accepted: ' + json.dumps(result)[:300])
            finally:
                f.stop(); f.ca, f.tlskey = original; f.start()
        check('runner12.wrong-hostname-refused', wrong_hostname)

        # ---------------------------------------------- exact-byte proof interoperability
        proof = {}
        def modified_payload():
            request = {'config_path': str(transport), 'payload_json': describe_payload(), 'operation_id': uid(), 'idempotency_key': uid(), 'correlation_id': uid(), 'seconds': str(int(time.time())), 'nonce': uid()}
            proof.update(ok('supervisor.proof', request))
            body = proof['body']; tampered = body.replace(request['correlation_id'], uid())
            status, response, raw = https(f, tampered, proof['headers']); denials.append({'response': response, 'raw': raw})
            expect(status in (400, 401, 403) and response.get('ok') is False, 'modified payload accepted: ' + raw[:300])
            status, response, raw = https(f, body, proof['headers'])
            expect(status == 200 and response.get('ok') is True, 'exact native proof refused: ' + raw[:300])
        check('runner12.modified-payload-refused', modified_payload)

        def replay():
            status, response, raw = https(f, proof['body'], proof['headers']); denials.append({'response': response, 'raw': raw})
            expect(status in (401, 403, 409) and response.get('ok') is False, 'replayed signed request accepted: ' + raw[:300])
            nonce = uid(); seconds = str(int(time.time()))
            first = call('supervisor.invoke', transport, describe_payload(), seconds=seconds, nonce=nonce)
            second = call('supervisor.invoke', transport, describe_payload(), seconds=seconds, nonce=nonce); denials.append(second)
            expect(first['accepted'] is True and second['accepted'] is False, 'native nonce replay accepted')
        check('runner12.replayed-nonce-refused', replay)

        def stale_time():
            result = call('supervisor.invoke', transport, describe_payload(), seconds=str(int(time.time()) - 900), nonce=uid()); denials.append(result)
            expect(result['accepted'] is False and result['http_status'] in (401, 403), 'stale request time accepted')
        check('runner12.stale-request-time-refused', stale_time)

        def wrong_key():
            config = work / 'wrong-key-transport.json'; settings = json.loads(transport.read_text()); settings['key_path'] = str(f.keys['other']['path']); private(config, settings)
            result = call('supervisor.invoke', config, describe_payload()); denials.append(result)
            expect(result['accepted'] is False and result['http_status'] in (401, 403), 'wrong key accepted')
        check('runner12.wrong-key-refused', wrong_key)

        # ---------------------------------------------- isolated writable slots
        slot_root = Path(tempfile.mkdtemp(prefix='hf-runner12-slots-')); slot_root.chmod(0o711)
        created.extend(users(5))
        base = {'root': str(slot_root), 'boot_id': f.ids['boot'], 'preparation_digest': f.preparation, 'config_path': str(transport), 'run_id': f.ids['run'], 'boot_generation': '1'}
        def slot_request(index, profile='distinct_uid', sensitive=False, storage=None, slot_id=None):
            request = dict(base, slot_id=slot_id or uid(), uid=created[index][1], gid=created[index][2], isolation_profile=profile, credential_sensitive=sensitive)
            if storage: request['storage_bytes'] = storage
            return request
        slots = {}
        check('runner12.worktree-only-profile-refused', lambda: refused('supervisor.slot.allocate', slot_request(0, 'worktree_only'), 'WORKTREE_IS_NOT_AN_OS_BOUNDARY'))

        def allocate():
            for name, index in (('a', 0), ('b', 1)):
                request = slot_request(index, storage=8 * 1048576)
                slots[name] = ok('supervisor.slot.allocate', request); slots[name + '_request'] = request
            a, b = slots['a'], slots['b']
            expect(a['uid'] != b['uid'] and a['port'] != b['port'] and a['isolation_boundary'] == 'shared-kernel-distinct-uid' and a['vm_level_isolation'] is False and a['worktree_is_security_boundary'] is False, 'slot identities/profile not separate')
            for slot in (a, b):
                for path in slot['paths'].values():
                    st = os.stat(path); expect(st.st_uid == slot['uid'] and st.st_mode & 0o777 == 0o700, 'slot path not private: ' + path)
                expect(slot['environment']['HOME'].startswith(str(slot_root / slot['slot_id'])) and slot['environment']['TMPDIR'] == slot['paths']['tmp'] and slot['storage']['kind'] == 'dedicated-tmpfs', 'slot defaults escape the slot')
            expect(set(a['paths'].values()).isdisjoint(b['paths'].values()) and set(a['environment'].values()).isdisjoint(b['environment'].values()), 'slot paths collide')
            replay = ok('supervisor.slot.allocate', slots['a_request'])
            expect(replay['replayed'] is True and replay['port'] == a['port'], 'slot replay not idempotent')
            conflict = dict(slots['a_request'], uid=created[2][1], gid=created[2][2])
            rc, _, code = native('supervisor.slot.allocate', conflict)
            expect(rc != 0 and code == 'SLOT_IDEMPOTENCY_OR_RECOVERY_CONFLICT', 'slot identity reuse admitted')
        check('runner12.slot-allocation-separates-resources', allocate)

        def colliding():
            a, b = slots['a'], slots['b']
            workers = [as_slot(a, 'build', 'slot-a', stdin=True), as_slot(b, 'build', 'slot-b', stdin=True)]; children.extend(workers)
            ready = [json.loads(w.stdout.readline()) for w in workers]
            expect(all(r['ready'] for r in ready), 'concurrent slot builds did not both bind')
            for w in workers: w.stdin.close()
            for w in workers: w.wait(timeout=20); expect(w.returncode == 0, 'slot build failed: ' + w.stderr.read()[:300])
            for slot, tag, seen in ((a, 'slot-a', ready[0]), (b, 'slot-b', ready[1])):
                expect(seen['cwd'] == slot['paths']['worktree'] and seen['uid'] == slot['uid'], 'worker not confined to its slot')
                for path in seen['written'].values():
                    expect(path.startswith(str(slot_root / slot['slot_id']) + '/') and Path(path).read_text() == tag, 'default path collided: ' + path)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0)); fixed = probe.getsockname()[1]
            contenders = [as_slot(a, 'default-port', 'a', fixed, stdin=True), as_slot(b, 'default-port', 'b', fixed, stdin=True)]; children.extend(contenders)
            outcome = [json.loads(c.stdout.readline()) for c in contenders]
            for c in contenders: c.stdin.close(); c.wait(timeout=10)
            expect(sorted(o['bound'] for o in outcome) == [False, True], 'shared default port silently co-bound: ' + json.dumps(outcome))
        check('runner12.colliding-default-paths-isolated', colliding)

        def cross():
            a, b = slots['a'], slots['b']
            targets = [b['paths']['home'] + '/.toolrc', b['paths']['build'] + '/out.o', b['paths']['tmp'] + '/intrusion', str(slot_root / '.supervisor-slots.db')]
            result = finished(as_slot(a, 'cross', 'a', *targets))
            expect(all(value == 'EACCES' for value in result.values()), 'cross-slot write admitted: ' + json.dumps(result))
            expect(Path(b['paths']['build'] + '/out.o').read_text() == 'slot-b', 'other slot result altered')
        check('runner12.cross-slot-access-denied', cross)

        def exhaustion():
            a, b = slots['a'], slots['b']
            filled = finished(as_slot(a, 'fill', 'accepted-a'), timeout=120)
            expect(filled['error'] in ('ENOSPC', 'EDQUOT') and filled['written'] <= 8 * 1048576, 'slot storage was not bounded: ' + json.dumps(filled))
            expect(finished(as_slot(b, 'write', 'accepted-b'))['written'] is True, 'neighbour slot lost writable storage')
            expect(Path(a['paths']['build'] + '/accepted-result.txt').read_text() == 'accepted-a' and Path(b['paths']['build'] + '/accepted-result.txt').read_text() == 'accepted-b', 'accepted result corrupted')
            inventory = ok('supervisor.slot.inventory', {'root': str(slot_root), 'boot_id': f.ids['boot'], 'preparation_digest': f.preparation})
            pressure = {item['slot_id']: item for item in inventory['pressure']['slots']}
            expect(pressure[a['slot_id']]['free_bytes'] < 1048576 and pressure[b['slot_id']]['free_bytes'] > 4 * 1048576 and inventory['pressure']['memory_available_bytes'] > 0, 'storage pressure not exposed per slot')
            EVIDENCE['slot_pressure'] = inventory['pressure']
        check('runner12.storage-exhaustion-contained', exhaustion)

        check('runner12.credential-sensitive-shared-kernel-refused', lambda: refused('supervisor.slot.allocate', slot_request(2, 'distinct_uid', True), 'CREDENTIAL_SENSITIVE_REQUIRES_VM_BOUNDARY'))
        check('runner12.vm-dedicated-colocation-refused', lambda: refused('supervisor.slot.allocate', slot_request(2, 'vm_dedicated', True), 'UNSAFE_COLOCATION_REFUSED'))

        # ---------------------------------------------- daemon with ledger-derived inventory
        daemon_config = work / 'daemon.json'; state = work / 'daemon-state'; state.mkdir(mode=0o700)
        observations = work / 'slot-observations.json'
        private(daemon_config, {'transport_config': str(transport), 'state_dir': str(state), 'organisation_id': f.ids['organisation'], 'slot_root': str(slot_root), 'preparation_digest': f.preparation, 'slot_observations_path': str(observations), 'heartbeat_interval_ms': 1000})
        def status_row(credential=None):
            rows = f.sql('SELECT state_version::text,preparation_digest,inventory FROM hyperfide.identity_runner_status WHERE credential_id=$1', [credential or enrolled['credential_id']])
            return rows[0] if rows else None
        def wait_for(fn, timeout=20):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                value = fn()
                if value: return value
                time.sleep(.1)
            raise AssertionError('bounded condition not reached')
        def serve(config):
            child = subprocess.Popen([str(NATIVE), '--component', '12.1', '--action', 'supervisor.serve'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=RUNNER_ENV)
            child.stdin.write(canonical({'config_path': str(config)}).encode()); child.stdin.close(); child.stdin = None
            children.append(child); return child
        daemon = {}
        def derived():
            daemon['child'] = serve(daemon_config)
            row = wait_for(status_row)
            inventory = ok('supervisor.slot.inventory', {'root': str(slot_root), 'boot_id': f.ids['boot'], 'preparation_digest': f.preparation})
            expect(row['inventory'] == inventory['inventory'] and row['preparation_digest'] == f.preparation, 'registered inventory differs from slot ledger')
            expect(sorted(item['slot_id'] for item in row['inventory']) == sorted([slots['a']['slot_id'], slots['b']['slot_id']]), 'registered slots differ from allocated slots')
            expect(all(item['os_boot_id'] == inventory['os_boot_id'] and item['worktree_is_security_boundary'] is False for item in row['inventory']), 'inventory lacks boot/profile truth')
            event = json.loads(daemon['child'].stdout.readline())
            expect(event['event'] == 'RUNNER_HEARTBEATING' and event['dispatch_ready'] is False, 'daemon did not report registration')
        check('runner12.daemon-registers-derived-inventory', derived)

        def heartbeat():
            before = int(status_row()['state_version'])
            wait_for(lambda: int(status_row()['state_version']) > before)
            expect(daemon['child'].poll() is None, 'daemon exited')
        check('runner12.daemon-heartbeat-real-https', heartbeat)

        def reregister():
            slots['d'] = ok('supervisor.slot.allocate', slot_request(3))
            row = wait_for(lambda: (lambda r: r if any(i['slot_id'] == slots['d']['slot_id'] for i in r['inventory']) else None)(status_row()))
            expect(len(row['inventory']) == 3, 'new slot not registered')
            ok('supervisor.slot.release', {'root': str(slot_root), 'slot_id': slots['d']['slot_id']})
            wait_for(lambda: len(status_row()['inventory']) == 2)
        check('runner12.daemon-reregisters-on-slot-change', reregister)

        def observations_verified():
            a, b = slots['a'], slots['b']
            def observation(slot, **change):
                item = {'session_id': uid(), 'slot_id': slot['slot_id'], 'repository_id': uid(), 'launch_id': None, 'state_dir': str(work / 'launch'), 'runner_binary': str(NATIVE), 'workspace_path': slot['paths']['worktree'] + '/repo', 'home_path': slot['paths']['home'], 'tmp_path': slot['paths']['tmp'], 'runner_binary_digest': sha(b'native'), 'preparation_digest': f.preparation, 'readiness_digest': sha(b'ready'), 'source_digest': sha(b'source'), 'source_object_id': '0' * 40, 'source_tree_id': '1' * 40, 'slot_generation': '1', 'uid': slot['uid'], 'gid': slot['gid']}
                item.update(change); return item
            genuine = observation(a)
            forged = [observation(a, uid=b['uid'], gid=b['gid']), observation(a, home_path=b['paths']['home']), observation(b, workspace_path=a['paths']['worktree']), observation(a, slot_id=uid())]
            private(observations, [genuine, *forged])
            try:
                row = wait_for(lambda: (lambda r: r if len(r['inventory']) != 2 else None)(status_row()))
            except AssertionError:
                alive = daemon['child'].poll() is None
                raise AssertionError('observation re-registration not reached; daemon ' + ('running' if alive else 'exited: ' + daemon['child'].stderr.read().decode(errors='replace')[-300:]))
            sessions = [item for item in row['inventory'] if 'session_id' in item]
            expect(sessions == [genuine] and len(row['inventory']) == 3, 'unverified slot observation registered: ' + json.dumps(sessions)[:400])
            observations.unlink()
            wait_for(lambda: len(status_row()['inventory']) == 2)
        check('runner12.daemon-verifies-slot-observations', observations_verified)

        def reconnect():
            f.stop()
            pending = wait_for(lambda: (json.loads((state / 'daemon-state.json').read_text()).get('pending')))
            time.sleep(1.5)
            expect(json.loads((state / 'daemon-state.json').read_text())['pending'] == pending and daemon['child'].poll() is None, 'outage changed pending operation or killed daemon')
            f.start()
            wait_for(lambda: json.loads((state / 'daemon-state.json').read_text()).get('pending') is None, timeout=30)
            expect(int(status_row()['state_version']) == int(json.loads((state / 'daemon-state.json').read_text())['state_version']), 'reconnect did not converge with 14.1')
            daemon['child'].send_signal(signal.SIGTERM); daemon['child'].wait(timeout=15)
            expect(daemon['child'].returncode == 0, 'daemon did not stop cleanly')
        check('runner12.daemon-reconnects-after-outage', reconnect)

        def override():
            other_state = work / 'override-state'; other_state.mkdir(mode=0o700)
            config = work / 'override.json'
            private(config, {'transport_config': str(transport), 'state_dir': str(other_state), 'organisation_id': f.ids['organisation'], 'slot_root': str(slot_root), 'preparation_digest': f.preparation, 'boot_id': uid(), 'heartbeat_interval_ms': 1000})
            child = serve(config); child.wait(timeout=10)
            expect(child.returncode != 0 and b'DAEMON_CONFIGURATION_INVALID' in child.stderr.read(), 'operator boot identity overrode server identity')
        check('runner12.daemon-refuses-identity-override', override)

        # ---------------------------------------------- slot release and VM-dedicated exclusivity
        def release():
            a = slots['a']
            holder = as_slot(a, 'default-port', 'hold', 0, stdin=True); children.append(holder); holder.stdout.readline()
            refused('supervisor.slot.release', {'root': str(slot_root), 'slot_id': a['slot_id']}, 'SLOT_PROCESSES_ACTIVE')
            holder.stdin.close(); holder.wait(timeout=10)
            for name in ('a', 'b'):
                result = ok('supervisor.slot.release', {'root': str(slot_root), 'slot_id': slots[name]['slot_id']})
                expect(result['released'] is True and result['storage_discarded'] is True, 'slot not released')
                st = os.stat(slot_root / slots[name]['slot_id']); expect(st.st_uid == 0 and st.st_mode & 0o777 == 0o700, 'released slot not quarantined')
        check('runner12.release-quarantines-slot', release)

        def exclusive():
            sensitive = ok('supervisor.slot.allocate', slot_request(2, 'vm_dedicated', True))
            expect(sensitive['vm_level_isolation'] is True and sensitive['credential_sensitive'] is True and sensitive['isolation_boundary'] == 'dedicated-vm-boot', 'VM-level profile not recorded')
            refused('supervisor.slot.allocate', slot_request(4), 'UNSAFE_COLOCATION_REFUSED')
            inventory = ok('supervisor.slot.inventory', {'root': str(slot_root), 'boot_id': f.ids['boot'], 'preparation_digest': f.preparation})['inventory']
            expect([item['isolation_profile'] for item in inventory] == ['vm_dedicated'] and inventory[0]['credential_sensitive'] is True, 'inventory lacks isolation profile')
            ok('supervisor.slot.release', {'root': str(slot_root), 'slot_id': sensitive['slot_id']})
            expect(ok('supervisor.slot.allocate', slot_request(4))['isolation_profile'] == 'distinct_uid', 'released VM-dedicated slot still blocks')
        check('runner12.vm-dedicated-exclusive', exclusive)

        # ---------------------------------------------- credential rotation
        rotated = {}
        def rotation():
            stolen_key = work / 'stolen-old.pem'; shutil.copyfile(key_path, stolen_key); stolen_key.chmod(0o600)
            stolen = work / 'stolen-transport.json'; settings = json.loads(transport.read_text()); settings['key_path'] = str(stolen_key); private(stolen, settings)
            rotated['stolen'] = stolen
            renewed = call('supervisor.invoke', transport, describe_payload(action='identity.principal.renew', input={'ttl_seconds': 600}))
            expect(renewed['accepted'] is True and int(renewed['response']['result']['credential_version']) >= 2, 'credential renewal refused')
            rotation_grant = uid(); issue(rotation_grant)
            grant_file = keys / 'rotation-grant.json'; private(grant_file, {'grant_id': rotation_grant, 'secret_b64': b64(f.secret)})
            request = {'config_path': str(transport), 'grant_path': str(grant_file), 'provisioning_intent_id': f.ids['intent'], 'run_id': f.ids['run'], 'sandbox_id': f.ids['sandbox'], 'boot_id': f.ids['boot'], 'boot_generation': '1'}
            before = transport.read_bytes()
            f.stop()
            try:
                first = ok('supervisor.rotate', request)
            finally:
                f.start()
            journal_path = Path(str(transport) + '.rotation.json'); journal = json.loads(journal_path.read_text())
            expect(first['rotated'] is False and first['rotation_pending'] is True and transport.read_bytes() == before and key_path.exists(), 'outage changed installed credential')
            # 14.1 admits one live RUNNER per boot: the old credential stays live until retired.
            blocked = ok('supervisor.rotate', request)
            expect(blocked['rotated'] is False and blocked['rotation_pending'] is True and json.loads(journal_path.read_text()) == journal and transport.read_bytes() == before, 'rotation bypassed one-live-runner invariant')
            version = f.sql('SELECT credential_version::text AS v FROM hyperfide.identity_principals WHERE credential_id=$1', [enrolled['credential_id']])[0]['v']
            response = f.invoke('identity.principal.revoke', {'credential_id': enrolled['credential_id'], 'expected_version': version})[1]
            expect(response.get('ok') is True, 'coordinator retirement failed: ' + json.dumps(response)[:300])
            # Commit the exact journaled enrollment through 14.1 and discard the reply.
            f.keys['rotated'] = {'path': Path(journal['new_key_path']), 'public_key_b64': journal['public_key_b64']}
            payload = journal['payload'].encode()
            envelope = {'protocol_version': 1, 'operation_id': journal['operation_id'], 'idempotency_key': journal['idempotency_key'], 'payload_digest': sha(payload), 'correlation_id': journal['correlation_id'], 'causation_id': None, 'payload_b64': b64(payload)}
            status, lost = f.request(envelope, key='rotated', endpoint='/v1/enroll', credential=rotation_grant)
            expect(status == 200 and lost.get('ok') is True, 'journaled enrollment not committed: ' + json.dumps(lost)[:300])
            second = ok('supervisor.rotate', request)
            expect(second['rotated'] is True and second['resumed'] is True and second['new_credential_id'] == lost['result']['credential_id'] and second['old_credential_id'] == enrolled['credential_id'], 'lost reply minted another credential: ' + json.dumps(second))
            config = json.loads(transport.read_text())
            expect(config['credential_id'] == second['new_credential_id'] and config['key_path'] == journal['new_key_path'] and second['old_key_destroyed'] is True and not key_path.exists() and not grant_file.exists() and not journal_path.exists(), 'rotation not atomically installed/retired')
            count = f.sql("SELECT count(*)::int AS n FROM hyperfide.identity_principals WHERE run_id=$1 AND role='RUNNER' AND public_key_b64=$2", [f.ids['run'], journal['public_key_b64']])[0]['n']
            expect(count == 1, 'replayed rotation created duplicate principals')
            rotated.update(second)
        check('runner12.rotation-lost-reply-recovers', rotation)

        def rotated_active():
            result = call('supervisor.invoke', transport, describe_payload())
            expect(result['accepted'] is True and result['response']['result']['principal']['credential_id'] == rotated['new_credential_id'], 'rotated credential not active')
            fresh = work / 'rotated-state'; fresh.mkdir(mode=0o700); config = work / 'rotated-daemon.json'
            private(config, {'transport_config': str(transport), 'state_dir': str(fresh), 'organisation_id': f.ids['organisation'], 'slot_root': str(slot_root), 'preparation_digest': f.preparation, 'heartbeat_interval_ms': 1000})
            child = serve(config)
            try:
                row = wait_for(lambda: status_row(rotated['new_credential_id']))
                expect(len(row['inventory']) == 1, 'rotated daemon inventory differs from ledger')
            finally:
                child.send_signal(signal.SIGTERM); child.wait(timeout=15)
            expect(child.returncode == 0, 'rotated daemon did not stop cleanly')
        check('runner12.rotated-credential-active', rotated_active)

        def revoked():
            result = call('supervisor.invoke', rotated['stolen'], describe_payload()); denials.append(result)
            expect(result['accepted'] is False and result['http_status'] in (401, 403), 'revoked credential accepted')
            old_daemon = work / 'revoked-daemon.json'; old_state = work / 'revoked-state'; old_state.mkdir(mode=0o700)
            private(old_daemon, {'transport_config': str(rotated['stolen']), 'state_dir': str(old_state), 'organisation_id': f.ids['organisation'], 'run_id': f.ids['run'], 'sandbox_id': f.ids['sandbox'], 'boot_id': f.ids['boot'], 'boot_generation': '1', 'runner_registration_path': str(write_registration()), 'heartbeat_interval_ms': 1000})
            child = serve(old_daemon); child.wait(timeout=15)
            expect(child.returncode != 0 and b'DAEMON_REQUEST_REJECTED_PENDING_RETAINED' in child.stderr.read(), 'revoked runner daemon was not refused')
        def write_registration():
            path = work / 'revoked-registration.json'; private(path, {'preparation_digest': f.preparation, 'inventory': []}); return path
        check('runner12.revoked-credential-refused', revoked)

        def no_secret_leak():
            text = json.dumps(denials)
            secrets_seen = [b64(f.secret), key_path.read_text() if key_path.exists() else '-----BEGIN PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----', f.runtime_url]
            expect(len(denials) >= 8 and not any(secret and secret in text for secret in secrets_seen), 'denial leaked secret material')
            expect(all((d.get('response') or {}).get('ok') is False for d in denials if isinstance(d.get('response'), dict)), 'a denial reported success')
        check('runner12.denials-leak-no-secrets', no_secret_leak)
    finally:
        for child in children:
            if child.poll() is None:
                child.kill(); child.wait(timeout=5)
        if slot_root is not None:
            for entry in slot_root.iterdir() if slot_root.exists() else []:
                if entry.is_dir() and os.path.ismount(entry): subprocess.run(['umount', '-l', str(entry)], check=False)
            shutil.rmtree(slot_root, ignore_errors=True)
        for name, _, _ in created:
            subprocess.run(['userdel', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        if f: f.close()
        folder.cleanup()

    def node_suite():
        env = dict(os.environ)
        result = run(['node', '--test', 'tests/hyperfide/support/reproduction_jobs.test.mjs'], env=env, timeout=600)
        expect(result.returncode == 0 and re.search(r'# fail 0|ℹ fail 0', result.stdout), 'reproduction job suite failed: ' + result.stdout[-800:])
    check('runner12.reproduction-jobs-node-suite', node_suite)

    def daemon_fixture():
        # Lifecycle/backpressure fixture; its entrypoint probe drives this exact pinned binary.
        env = dict(os.environ, HF_SUPERVISOR_DAEMON_NATIVE_BINARY=str(NATIVE), HF_SUPERVISOR_DAEMON_NATIVE_SHA256=hashlib.sha256(NATIVE.read_bytes()).hexdigest())
        result = run(['python3', 'tests/hyperfide/support/supervisor_daemon_fixture.py'], env=env, timeout=600)
        rows = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        assertions = [row for row in rows if row.get('type') == 'assertion']
        failed = [row['id'] + ': ' + row['actual'] for row in assertions if row['actual'] != 'observed']
        expect(result.returncode == 0 and not failed and len(assertions) >= 30 and sum(row['id'].startswith('daemon.entry-') for row in assertions) >= 5, 'daemon lifecycle fixture failed: ' + '; '.join(failed)[:800] + result.stderr[-400:])
        expect(any(row.get('type') == 'cleanup' and row.get('complete') is True for row in rows), 'daemon fixture cleanup incomplete')
    check('runner12.daemon-lifecycle-linked-binary', daemon_fixture)
    absent = [name for name, _, _ in created if run(['getent', 'passwd', name]).returncode == 0]
    campaign = os.environ.get('HYPERFIDE_CAMPAIGN_DIR')
    if campaign:
        Path(campaign).mkdir(parents=True, exist_ok=True)
        (Path(campaign) / 'runner12-observations.json').write_text(json.dumps(EVIDENCE, sort_keys=True) + '\n')
    complete = not absent and (slot_root is None or not slot_root.exists())
    print(json.dumps({'type': 'cleanup', 'resources': [], 'complete': complete}), flush=True)
    return 1 if FAILED or not complete else 0

if __name__ == '__main__':
    sys.exit(main())
