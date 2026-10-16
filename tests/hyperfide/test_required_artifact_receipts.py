#!/usr/bin/env python3
"""Regress mutable required artifacts across genuinely different receipt runs."""
import json
import os
import subprocess
from pathlib import Path
import sys
import unittest
from selftest_harness import Fixture, PROBE, RUNNER, seal_receipt

class DefaultCampaignFixture(Fixture):
    def run(self, *selector, extra=(), runner=None):
        # Match production sequential-case execution: default campaign directory.
        argv = [sys.executable, str(runner or RUNNER), "--root", str(self.root),
                "--registry", str(self.root / "registry.json"),
                "--manifest", str(self.root / "manifest.json")]
        env = os.environ.copy()
        env.pop("HYPERFIDE_SELFTEST_REQUIRED_CREDENTIAL", None)
        return subprocess.run(argv + list(selector) + list(extra), capture_output=True,
                              text=True, env=env, timeout=35)

class RequiredArtifactReceiptTests(unittest.TestCase):
    def setUp(self):
        self.fixture = DefaultCampaignFixture()
    def tearDown(self):
        self.fixture.close()
    def dynamic(self):
        fixture = self.fixture
        fixture.registry['cases']['V-055']={'title':'Second selected component case','full_assertion_ids':[]}
        fixture.registration['cases']=['V-056','V-055']
        fixture.manifest['case_ids']=['V-056','V-055']
        fixture.registration['required_artifacts']=['nested/one/output.json','nested/two/output.json']
        probe = PROBE + '\nimport uuid\nfor name in '+repr(fixture.registration['required_artifacts'])+':\n path=Path(os.environ["HYPERFIDE_CAMPAIGN_DIR"])/name\n path.parent.mkdir(parents=True,exist_ok=True)\n path.write_text(json.dumps({"execution":str(uuid.uuid4()),"name":name}))\n'
        (fixture.root/'probe.py').write_text(probe)
        fixture.pin('probe.py');fixture.save()
        return fixture
    def receipt(self, campaign, summary):
        return json.loads((campaign/'receipts'/(summary['receipt_id']+'.json')).read_text())
    def required(self, receipt):
        return [row for row in receipt['artifacts'] if row['kind']=='required']
    def test_two_cases_preserve_distinct_artifact_bytes(self):
        fixture=self.dynamic()
        campaign,first=fixture.successful('--case','V-056')
        first_rows=self.required(self.receipt(campaign,first))
        initial={row['path']:(campaign/row['path']).read_bytes() for row in first_rows}
        same,second=fixture.successful('--case','V-055')
        self.assertEqual(campaign,same)
        second_rows=self.required(self.receipt(campaign,second))
        self.assertEqual(len(list((campaign/'receipts').glob('*.json'))),2)
        self.assertEqual({row['logical_path'] for row in first_rows},set(fixture.registration['required_artifacts']))
        self.assertFalse({row['path'] for row in first_rows}&{row['path'] for row in second_rows})
        for old,new in zip(first_rows,second_rows):
            self.assertEqual(initial[old['path']],(campaign/old['path']).read_bytes())
            self.assertNotEqual(initial[old['path']],(campaign/new['path']).read_bytes())
        self.assertEqual(fixture.check(campaign,first['receipt_id']).returncode,0)
        self.assertEqual(fixture.check(campaign,second['receipt_id']).returncode,0)
    def test_tampered_old_snapshot_still_fails(self):
        fixture=self.dynamic();campaign,first=fixture.successful('--case','V-056')
        fixture.successful('--case','V-055')
        old=self.required(self.receipt(campaign,first))[0]
        path=campaign/old['path'];path.chmod(0o600);path.write_bytes(b'tampered old evidence')
        result=fixture.check(campaign,first['receipt_id'])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('artifact content/hash/size mismatch',result.stdout+result.stderr)
    def test_alias_cannot_redirect_to_another_logical_artifact(self):
        fixture=self.dynamic();campaign,first=fixture.successful('--case','V-056')
        receipt=self.receipt(campaign,first);self.required(receipt)[0]['logical_path']='nested/forged/output.json'
        seal_receipt(receipt);(campaign/'receipts'/(first['receipt_id']+'.json')).write_text(json.dumps(receipt))
        result=fixture.check(campaign,first['receipt_id'])
        self.assertNotEqual(result.returncode,0)
        self.assertIn('required artifact is not bound to its receipt snapshot',result.stdout+result.stderr)
    def test_real_cleanup_reference_uses_immutable_absence_evidence(self):
        fixture=self.fixture
        source=PROBE.replace('if mode != "no-cleanup":','if False:')+'\nPath("owned-fixture.txt").write_text("owned disposable fixture")\n'
        (fixture.root/'probe.py').write_text(source)
        cleanup='import json,os\nfrom pathlib import Path\np=Path("owned-fixture.txt");p.unlink()\nabsent=not p.exists()\ne=Path(os.environ["HYPERFIDE_CAMPAIGN_DIR"])/"cleanup/absence.json";e.parent.mkdir(parents=True,exist_ok=True);e.write_text(json.dumps({"observed_absent":absent}))\nprint(json.dumps({"type":"cleanup","resources":[{"id":"owned-fixture","status":"deleted","observed_absent":absent,"evidence_artifact":"cleanup/absence.json"}],"complete":absent}))\n'
        (fixture.root/'cleanup.py').write_text(cleanup)
        fixture.registration['resources']=[{'id':'owned-fixture'}]
        fixture.manifest['resources']=[{'id':'owned-fixture'}]
        fixture.registration['cleanup_argv']=[sys.executable,'cleanup.py']
        fixture.registration['source_files'].append('cleanup.py')
        fixture.registration['required_artifacts']=['cleanup/absence.json']
        fixture.pin('probe.py');fixture.pin('cleanup.py');fixture.save()
        campaign,summary=fixture.successful()
        self.assertFalse((fixture.root/'owned-fixture.txt').exists())
        (campaign/'cleanup/absence.json').write_text('later mutable scratch')
        self.assertEqual(fixture.check(campaign,summary['receipt_id']).returncode,0)
        saved=self.required(self.receipt(campaign,summary))[0]
        self.assertTrue(json.loads((campaign/saved['path']).read_text())['observed_absent'])

if __name__=='__main__':unittest.main(verbosity=2)
