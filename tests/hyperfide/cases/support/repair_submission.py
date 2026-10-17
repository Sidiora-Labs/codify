"""Submit a running repair through worker delegation, artifact15 and custody16."""
from __future__ import annotations

import base64
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


class RepairSubmission:
    def __init__(self, root):
        self.root = root
        self.directory = tempfile.TemporaryDirectory(prefix='hyperfide-repair-source-')
        self.repository = Path(self.directory.name)
        self.store = None
        try:
            self.git('init', '-q')
            self.git('config', 'user.name', 'Repair fixture')
            self.git('config', 'user.email', 'fixture@example.invalid')
            (self.repository / 'src').mkdir()
            (self.repository / 'src/claim-a.ts').write_text('original failure\n')
            self.recipe = dict(schema_version=1, kind='hyperfide.preparation-policy', commands=[],
                               cache_scope='repair', cache_paths=[], minimum_free_bytes='1',
                               minimum_free_inodes='1', network_timeout_milliseconds=1000)
            (self.repository / 'prepare.json').write_text(json.dumps(self.recipe))
            (self.repository / 'scan.json').write_text('{"prepared":true}\n')
            self.git('add', '--all')
            self.git('commit', '-qm', 'accepted baseline')
            self.baseline = self.git('rev-parse', 'HEAD')
            (self.repository / 'src/claim-a.ts').write_text('repaired result\n')
            self.git('commit', '-qam', 'repair')
            self.head = self.git('rev-parse', 'HEAD')
            self.git('update-ref', 'refs/heads/repair', self.head)
            spec = importlib.util.spec_from_file_location('repair_objects', root / 'tests/hyperfide/cases/tasks/15_2.py')
            self.objects = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.objects)
            self.store = self.objects.ObjectFixture()
        except BaseException:
            self.close()
            raise

    def git(self, *args):
        return subprocess.check_output(
            ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', *args],
            cwd=self.repository, env=dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL='/dev/null'),
            text=True, stderr=subprocess.PIPE, timeout=15).strip()

    def setup(self, f):
        target = f.path / 'repair-source'
        self.repository.rename(target)
        self.repository = target
        o = self.objects
        f.env.update(HF_ARTIFACT_S3_ENDPOINT=self.store.endpoint, HF_ARTIFACT_ALLOW_LOOPBACK_HTTP='1',
                     HF_ARTIFACT_S3_REGION=o.REGION, HF_ARTIFACT_S3_BUCKET=o.BUCKET,
                     HF_ARTIFACT_S3_ACCESS_KEY_ID=o.KEY, HF_ARTIFACT_S3_SECRET_ACCESS_KEY=o.SECRET,
                     HF_ARTIFACT_S3_SESSION_TOKEN=o.TOKEN, HF_ARTIFACT_ORGANISATION_ID=f.ids['organisation'],
                     HF_ARTIFACT_ALLOWED_RUN_IDS=json.dumps([f.ids['run']]),
                     HF_QUALIFICATION_REPOSITORIES=json.dumps({f.ids['repository']:str(self.repository)}))

    def submit(self, f, token, c):
        i = f.ids
        workspace, session = c.uid(), c.uid()
        c.insert(f, 'workspaces', c.scoped(f, id=workspace, repository_id=i['repository'],
                 attempt_id=token['attempt_id'], attempt_generation=token['attempt_generation'],
                 sandbox_id=token['sandbox_id'], slot_id=token['slot_id'],
                 sandbox_boot_generation=token['sandbox_boot_generation'], base_commit=self.baseline,
                 branch_ref='refs/heads/repair', workspace_path=str(self.repository)))
        c.insert(f, 'agent_sessions', c.scoped(f, id=session, role='WORKER', parent_session_id=i['manager'],
                 connector='fixture', account_key='fixture', native_session_id='repair-worker',
                 slot_id=token['slot_id'], sandbox_id=token['sandbox_id'], sandbox_boot_generation='1',
                 attempt_id=token['attempt_id'], state='RUNNING'))
        f.delegate_principal('repair_worker', session)

        def put(value):
            data = json.dumps(value).encode()
            return f.ok('artifact.object.put', c.scoped(f, digest=c.sha(data), size_bytes=str(len(data)),
                        data_base64=base64.b64encode(data).decode(), retention_class='RUN', retention_until=None,
                        retention_hold=False), component='15.2')['artifact']['artifact_id']

        criteria = f.sql('SELECT criteria_digest FROM hyperfide.tasks WHERE id=$1', [token['task_id']])[0]['criteria_digest']
        log = put({'scope':'worker output; independent qualification still required'})
        source = put(dict(repository_id=i['repository'], source_object_id=self.head, workspace_id=workspace))
        evidence = put(dict(source_object_id=self.head, criteria_digest=criteria, artifact_ids=[log]))
        payload = c.scoped(f, **{key:token[key] for key in ('task_id','attempt_id','attempt_generation',
                          'authority_epoch','sandbox_id','slot_id','sandbox_boot_generation')},
                          request_id=c.uid(), repository_id=i['repository'], source_object_id=self.head,
                          source_manifest_artifact_id=source, evidence_manifest_artifact_id=evidence,
                          criteria_digest=criteria, contract_digests=[])
        operation = f.operation('16.1', 'submission.submit', payload, authority=f.authorities['repair_worker'])
        operation['idempotency_key'] = payload['request_id']
        status, body = f.request(operation, key='repair_worker')
        c.expect(status == 200 and body.get('ok') is True, 'Repair submission refused: '+str(body))
        return body['result']

    def close(self):
        if self.store is not None:
            self.store.stop()
        if self.repository.exists():
            shutil.rmtree(self.repository)
        self.directory.cleanup()
