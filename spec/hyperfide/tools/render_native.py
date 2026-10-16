#!/usr/bin/env python3
"""Render plan structure while preserving native implementation state.

Draft mode is the default and refuses approved/progressed inputs. Implementation
mode requires explicit approval and never imports live state from the plan.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from validate_pack import parse_kvx, strict_json, workflow_errors

MARKER = '# BEGIN GENERATED DRAFT TASKS AND CASES'
PLAN_FIELDS = ['title', 'wave', 'requires', 'touches', 'verify_cmd', 'reqs',
               'acceptance_ids', 'owner', 'artifacts', 'verification_scope']
STATUSES = {'pending', 'in_progress', 'implemented', 'done'}

def render(root, mode):
    spec = root / 'spec.kvx'
    original = spec.read_text()
    native = parse_kvx(original)
    meta, execution = native.get('meta', {}), native.get('execution', {})
    workflow_failures = workflow_errors(root, mode)
    if workflow_failures:
        raise ValueError('; '.join(workflow_failures))
    if mode == 'draft':
        if (meta.get('status') != 'draft' or meta.get('implementation_authorized') is not False
                or execution.get('state') != 'not_started' or execution.get('approval_record')):
            raise ValueError('draft rendering refuses approved implementation metadata')
    elif meta.get('implementation_authorized') is not True or meta.get('status') not in {'in_progress', 'done'} or execution.get('state') not in {'in_progress', 'completed'} or not isinstance(execution.get('approval_record'), str) or not execution['approval_record'].strip():
        raise ValueError('implementation rendering requires explicit approved native metadata')
    catalog = strict_json((root / 'evidence/task-catalog.json').read_text())
    if catalog.get('status') != 'draft' or catalog.get('implementation_authorized') is not False:
        raise ValueError('task catalog must remain the historical draft planning baseline')
    tasks = catalog.get('tasks', [])
    if not isinstance(tasks, list) or not tasks:
        raise ValueError('empty task catalog')
    by_id = {}
    clauses = {}
    for task in tasks:
        if task.get('status') != 'pending' or task.get('id') in by_id:
            raise ValueError('catalog must contain unique pending planning identities')
        by_id[task['id']] = task
        for case in task['acceptance_ids']:
            clauses.setdefault(case, set()).update(task['reqs'])
    existing_tasks = {key[5:]: value for key, value in native.items() if key.startswith('task.')}
    if set(existing_tasks) - set(by_id) or (mode == 'implementation' and set(existing_tasks) != set(by_id)):
        raise ValueError('native/catalog task identities differ; refusing state deletion or replacement')
    for task_id, state in existing_tasks.items():
        if state.get('status') not in STATUSES or (mode == 'draft' and state['status'] != 'pending'):
            raise ValueError('invalid or progressed native task status for rendering mode')
        plan = by_id[task_id]
        for field in PLAN_FIELDS:
            if state.get(field) != plan.get(field):
                raise ValueError(f'task {task_id}: native/catalog {field} differs; reconcile approved plan explicitly')
        steps = [state[key] for key in sorted((key for key in state if re.fullmatch(r'do_\d+', key)), key=lambda key: int(key[3:]))]
        if steps != plan['do_steps']:
            raise ValueError(f'task {task_id}: native/catalog steps differ')
    rows = []
    for line in (root / 'verification.md').read_text().splitlines():
        if re.match(r'^\| V-\d{3} \|', line):
            columns = [part.strip() for part in line.strip('|').split('|')]
            if len(columns) != 3:
                raise ValueError('invalid verification case table row')
            rows.append(columns)
    cases = {row[0] for row in rows}
    if len(rows) != 56 or len(cases) != 56 or set(clauses) != cases:
        raise ValueError('expected exactly 56 unique mapped verification cases')
    existing_cases = {key[len('acceptance.'):]: value for key, value in native.items() if key.startswith('acceptance.')}
    if set(existing_cases) - cases or (mode == 'implementation' and set(existing_cases) != cases):
        raise ValueError('native acceptance identities differ; refusing runtime evidence deletion')
    for state in existing_cases.values():
        if state.get('qualification') not in {'UNRUN', 'PASS', 'FAIL', 'BLOCKED'}:
            raise ValueError('invalid acceptance qualification status')
        if mode == 'draft' and state['qualification'] != 'UNRUN':
            raise ValueError('draft rendering refuses runtime qualification')
    header, found, tail = original.partition(MARKER)
    if not found:
        if existing_tasks or existing_cases:
            raise ValueError('missing generated boundary; refusing unsafe rewrite')
        header = original.rstrip() + '\n\n'
    else:
        for name in parse_kvx(tail):
            if not name.startswith(('task.', 'acceptance.')):
                raise ValueError('unrecognised section after generated boundary; refusing metadata loss')
    if any(name.startswith(('task.', 'acceptance.')) for name in parse_kvx(header)):
        raise ValueError('task or acceptance section precedes generated boundary; refusing duplicate output')
    lines = [MARKER, '# Plan structure from evidence/task-catalog.json and verification.md.',
             '# Native task status and runtime evidence are authoritative; planning status is historical.', '']
    def field(key, value):
        lines.append(key + ' = ' + json.dumps(value, ensure_ascii=False))
    for task in tasks:
        task_id = task['id']
        lines.append('[task.' + task_id + ']')
        state = existing_tasks.get(task_id, {})
        field('title', task['title'])
        field('status', state.get('status', 'pending'))
        for key in PLAN_FIELDS[1:]:
            field(key, task[key])
        for index, step in enumerate(task['do_steps'], 1):
            field('do_' + str(index), step)
        owned = set(PLAN_FIELDS) | {'status'} | {f'do_{index}' for index in range(1, len(task['do_steps']) + 1)}
        for key, value in state.items():
            if key not in owned:
                field(key, value)
        lines.append('')
    for case, scenario, expected in rows:
        lines.append('[acceptance.' + case + ']')
        defaults = {
            'feature': 'hyperfide',
            'reqs': sorted(clauses[case], key=lambda key: tuple(map(int, key.split('.')))),
            'scenario': scenario, 'expected': expected, 'contract': 'verification.md',
            'test': 'python3 tests/hyperfide/qualify.py --case ' + case + ' --manifest <immutable-full-case-campaign-manifest.json> (planned)',
            'qualification': 'UNRUN',
        }
        state = existing_cases.get(case, {})
        # Existing case contract and runtime fields are native-authoritative.
        # Rendering a planning table must never overwrite observed evidence.
        for key, value in dict(defaults, **state).items():
            field(key, value)
        lines.append('')
    content = header + '\n'.join(lines)
    parse_kvx(content)  # Refuse any duplicate or malformed candidate before writing.
    return original, content

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--mode', choices=['draft', 'implementation'], default='draft')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        original, content = render(args.root.resolve(), args.mode)
        if args.check:
            if original != content:
                print('native projection is stale', file=sys.stderr)
                return 2
        elif original != content:
            target = args.root / 'spec.kvx'
            with tempfile.NamedTemporaryFile('w', dir=target.parent, delete=False) as stream:
                stream.write(content)
                temporary = Path(stream.name)
            try:
                if target.read_text() != original:
                    raise ValueError('native specification changed during render; refusing overwrite')
                os.replace(temporary, target)
            finally:
                temporary.unlink(missing_ok=True)
        print(json.dumps({'mode': args.mode, 'changed': original != content, 'product_commands_executed': False,
                          'live_state_authority': 'native spec.kvx'}))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f'native rendering refused: {error}', file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
