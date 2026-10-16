#!/usr/bin/env python3
"""Render draft task/case sections only; never activate or run product work."""
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
spec = root / 'spec.kvx'
marker = '# BEGIN GENERATED DRAFT TASKS AND CASES'
text = spec.read_text().split(marker)[0].rstrip() + '\n\n'
catalog = json.loads((root / 'evidence/task-catalog.json').read_text())
assert catalog['status'] == 'draft' and catalog['implementation_authorized'] is False
clauses = {}
for task in catalog['tasks']:
    assert task['status'] == 'pending'
    for case in task['acceptance_ids']:
        clauses.setdefault(case, set()).update(task['reqs'])
rows = []
for line in (root / 'verification.md').read_text().splitlines():
    if re.match(r'^\| V-\d{3} \|', line):
        columns = [part.strip() for part in line.strip('|').split('|')]
        assert len(columns) == 3, columns
        rows.append(columns)
assert len(rows) == 56 and len({row[0] for row in rows}) == 56
assert set(clauses) == {row[0] for row in rows}
lines = [marker, '# Authoring projection from evidence/task-catalog.json and verification.md.', '# All commands below are planned interfaces and have NOT been executed.', '']
def field(key, value):
    lines.append(key + ' = ' + json.dumps(value, ensure_ascii=False))
for task in catalog['tasks']:
    lines.append('[task.' + task['id'] + ']')
    for key in ['title', 'status', 'wave', 'requires', 'touches', 'verify_cmd', 'reqs', 'acceptance_ids', 'owner', 'artifacts', 'verification_scope']:
        field(key, task[key])
    for index, step in enumerate(task['do_steps'], 1):
        field('do_' + str(index), step)
    lines.append('')
for case, scenario, expected in rows:
    lines.append('[acceptance.' + case + ']')
    field('feature', 'hyperfide')
    field('reqs', sorted(clauses[case], key=lambda x: tuple(map(int,x.split('.')))))
    field('scenario', scenario)
    field('expected', expected)
    field('contract', 'verification.md')
    field('test', 'python3 tests/hyperfide/qualify.py --case ' + case + ' --manifest <immutable-full-case-campaign-manifest.json> (planned)')
    field('qualification', 'UNRUN')
    lines.append('')
spec.write_text(text + '\n'.join(lines))
print(json.dumps({'tasks': len(catalog['tasks']), 'cases': len(rows), 'implementation_authorized': False, 'product_commands_executed': False}))
