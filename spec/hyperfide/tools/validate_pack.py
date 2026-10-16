#!/usr/bin/env python3
"""Validate the Hyperfide review pack, without executing product commands.

This checks authoring structure and references. It does not prove the proposed
architecture, provider behaviour, runtime correctness, or test implementation.
Only the requested JSON report is written. No third-party packages are used.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import itertools
import json
from pathlib import Path
import re
import runpy
import shlex
import sys
from urllib.parse import unquote, urlsplit


class InvalidKVX(ValueError):
    pass


def strict_json(text: str):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'duplicate JSON object key {key}')
            result[key] = value
        return result

    def invalid_constant(value):
        raise ValueError(f'non-JSON numeric constant {value}')

    return json.loads(text, object_pairs_hook=unique_pairs, parse_constant=invalid_constant)


def parse_kvx(text: str) -> dict:
    """Parse the deliberately simple, one-JSON-value-per-line pack subset."""
    sections = {}
    current = None
    for number, original in enumerate(text.splitlines(), 1):
        line = original.strip()
        if not line or line.startswith('#'):
            continue
        section = re.fullmatch(r'\[([A-Za-z0-9_.-]+)\]', line)
        if section:
            name = section.group(1)
            if name in sections:
                raise InvalidKVX(f'line {number}: duplicate section [{name}]')
            sections[name] = {}
            current = sections[name]
            continue
        assignment = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)', line)
        if not assignment or current is None:
            raise InvalidKVX(f'line {number}: unsupported or out-of-section syntax')
        key, value = assignment.groups()
        if key in current:
            raise InvalidKVX(f'line {number}: duplicate key {key}')
        try:
            current[key] = strict_json(value)
        except ValueError as error:
            raise InvalidKVX(f'line {number}: value must be a single JSON literal: {error}') from error
    return sections



def workflow_errors(root: Path, mode: str) -> list[str]:
    workflow = root.parent / 'workflow.kvx'
    if not workflow.is_file():
        return ['implementation mode requires the owning workflow.kvx'] if mode == 'implementation' else []
    try:
        sections = parse_kvx(workflow.read_text())
    except (OSError, InvalidKVX) as error:
        return [f'workflow.kvx: invalid owning workflow: {error}']
    active = sections.get('meta', {}).get('active_feature')
    if mode == 'implementation' and active != 'hyperfide':
        return ['implementation mode requires owning workflow active_feature=hyperfide']
    if mode == 'draft' and active == 'hyperfide':
        return ['Hyperfide draft has been activated before implementation approval']
    return []


def dependency_errors(tasks: dict) -> list[str]:
    errors = []
    indegree = {task_id: 0 for task_id in tasks}
    followers = defaultdict(list)
    for task_id, task in tasks.items():
        dependencies = task.get('requires', [])
        if not isinstance(dependencies, list) or any(not isinstance(dependency, str) for dependency in dependencies):
            errors.append(f'task {task_id}: requires must be a list of task-ID strings')
            continue
        if len(dependencies) != len(set(dependencies)):
            errors.append(f'task {task_id}: duplicate dependency')
        for dependency in dependencies:
            if dependency not in tasks:
                errors.append(f'task {task_id}: missing dependency {dependency}')
                continue
            indegree[task_id] += 1
            followers[dependency].append(task_id)
            wave, predecessor_wave = task.get('wave'), tasks[dependency].get('wave')
            if isinstance(wave, int) and isinstance(predecessor_wave, int) and predecessor_wave > wave:
                errors.append(f'task {task_id}: prerequisite {dependency} is in later wave')
    ready = [key for key, value in indegree.items() if value == 0]
    visited = []
    while ready:
        task_id = ready.pop()
        visited.append(task_id)
        for follower in followers[task_id]:
            indegree[follower] -= 1
            if indegree[follower] == 0:
                ready.append(follower)
    if len(visited) != len(tasks):
        errors.append('dependency cycle or cycle-dependent tasks: ' + ', '.join(sorted(set(tasks) - set(visited))))
    return errors


def task_errors(tasks: dict, clauses: set, cases: set, mode: str = 'draft') -> list[str]:
    errors = dependency_errors(tasks)
    covered = set()
    selected_cases = set()
    for task_id, task in tasks.items():
        if not re.fullmatch(r'\d+\.\d+', task_id):
            errors.append(f'invalid task ID {task_id}')
        if mode == 'draft' and task.get('status') != 'pending':
            errors.append(f'task {task_id}: draft status must remain pending')
        elif mode == 'implementation' and task.get('status') not in {'pending', 'in_progress', 'implemented', 'done'}:
            errors.append(f'task {task_id}: invalid native implementation status')
        for field in ['title', 'owner']:
            if not isinstance(task.get(field), str) or not task[field].strip():
                errors.append(f'task {task_id}: missing nonempty {field}')
        if type(task.get('wave')) is not int or task['wave'] < 1:
            errors.append(f'task {task_id}: wave must be a positive integer')
        reqs = task.get('reqs')
        if not isinstance(reqs, list) or not reqs:
            errors.append(f'task {task_id}: empty or invalid reqs')
            reqs = []
        for clause in reqs:
            if not isinstance(clause, str) or not re.fullmatch(r'\d+\.\d+', clause):
                errors.append(f'task {task_id}: invalid requirement reference {clause!r}')
            elif clause not in clauses:
                errors.append(f'task {task_id}: missing requirement {clause}')
            else:
                covered.add(clause)
        command = task.get('verify_cmd', '')
        if not isinstance(command, str):
            errors.append(f'task {task_id}: verify_cmd must be a string')
            command = ''
        try:
            arguments = shlex.split(command)
        except (ValueError, TypeError):
            arguments = []
            errors.append(f'task {task_id}: invalid verify_cmd quoting')
        selected = []
        for index, argument in enumerate(arguments):
            if argument == '--case' and index + 1 < len(arguments):
                selected.extend(arguments[index + 1].split(','))
        if not command or not selected:
            errors.append(f'task {task_id}: verify_cmd needs explicit nonempty --case selection')
        if 'tests/hyperfide/qualify.py' not in arguments:
            errors.append(f'task {task_id}: verify_cmd does not use the declared future qualification runner')
        if '--manifest' not in arguments or arguments.index('--manifest') + 1 >= len(arguments):
            errors.append(f'task {task_id}: verify_cmd needs an explicit qualification manifest')
        # Match the declared command contract rather than accepting a runner name
        # hidden inside echo, a comment, shell substitution or a conditional.
        segments, segment = [], []
        for argument in arguments:
            if argument == '&&':
                segments.append(segment)
                segment = []
            else:
                segment.append(argument)
        segments.append(segment)
        qualification_segments = segments
        if task_id == '27.1' and segments and segments[0] == ['python3', 'tests/hyperfide/selftest_harness.py']:
            qualification_segments = segments[1:]
        elif task_id == '27.1':
            errors.append('task 27.1: bootstrap must run independent harness self-tests before qualification')
        expected_manifest = f'tests/hyperfide/manifests/tasks/{task_id}.json'
        if not qualification_segments or any(
                len(part) != 6 or part[:3] != ['python3', 'tests/hyperfide/qualify.py', '--case']
                or not re.fullmatch(r'V-\d{3}', part[3])
                or part[4:] != ['--manifest', expected_manifest]
                for part in qualification_segments):
            errors.append(f'task {task_id}: verify_cmd violates explicit runner/selector/task-manifest grammar')
        if len(selected) != len(set(selected)):
            errors.append(f'task {task_id}: duplicate acceptance selection')
        for case in selected:
            if case not in cases:
                errors.append(f'task {task_id}: unknown acceptance case {case}')
            else:
                selected_cases.add(case)
        if re.search(r'(?:^|[;&|]\s*)(?:true|echo\s+PASS)(?:\s|$)', command) or '|| true' in command:
            errors.append(f'task {task_id}: success-masking or placeholder verify_cmd')
        for field in ['touches', 'artifacts']:
            value = task.get(field)
            if not isinstance(value, list) or not value or any(not isinstance(path, str) or not path.strip() or Path(path).is_absolute() or '..' in Path(path).parts for path in value):
                errors.append(f'task {task_id}: invalid or missing relative {field} paths')
        steps = {int(key[3:]): value for key, value in task.items() if re.fullmatch(r'do_\d+', key)}
        if not steps or sorted(steps) != list(range(1, len(steps) + 1)) or any(not isinstance(value, str) or not value.strip() for value in steps.values()):
            errors.append(f'task {task_id}: no implementation steps')
    if clauses - covered:
        errors.append('requirements without tasks: ' + ', '.join(sorted(clauses - covered)))
    if cases - selected_cases:
        errors.append('acceptance cases without task qualification commands: ' + ', '.join(sorted(cases - selected_cases)))
    return errors


def negative_self_tests() -> list[dict]:
    """In-memory fixtures; no implementation task or repository fixture runs."""
    checks = []
    for name, text in [('duplicate-section', '[x]\na = 1\n[x]\nb = 2'),
                       ('duplicate-key', '[x]\na = 1\na = 2'),
                       ('invalid-value', '[x]\na = unquoted'),
                       ('duplicate-nested-json-key', '[x]\na = {"b": 1, "b": 2}'),
                       ('invalid-json-numeric-constant', '[x]\na = NaN')]:
        try:
            parse_kvx(text)
            rejected = False
        except InvalidKVX:
            rejected = True
        checks.append({'fixture': name, 'expected_rejection_observed': rejected})
    template = {'title': 'Fixture task', 'owner': 'qualification', 'artifacts': ['artifacts/future.json'],
                'status': 'pending', 'wave': 1, 'requires': [], 'reqs': ['1.1'],
                'touches': ['future.py'], 'verify_cmd': 'python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/1.1.json', 'do_1': 'Implement.'}
    good = {'1.1': dict(template)}
    checks.append({'fixture': 'valid-control', 'expected_rejection_observed': not task_errors(good, {'1.1'}, {'V-001'})})
    for name, mutation, expected in [
            ('done-flag', {'status': 'done'}, 'draft status'),
            ('missing-dependency', {'requires': ['9.9']}, 'missing dependency'),
            ('missing-requirement', {'reqs': ['9.9']}, 'missing requirement'),
            ('unknown-case', {'verify_cmd': 'python3 tests/hyperfide/qualify.py --case V-999 --manifest future.json'}, 'unknown acceptance'),
            ('empty-selection', {'verify_cmd': 'python3 tests/hyperfide/qualify.py --manifest future.json'}, 'nonempty --case'),
            ('echoed-runner', {'verify_cmd': 'echo python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/1.1.json'}, 'runner/selector/task-manifest grammar'),
            ('wrong-task-manifest', {'verify_cmd': 'python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/2.1.json'}, 'runner/selector/task-manifest grammar'),
            ('success-masking', {'verify_cmd': template['verify_cmd'] + ' || true'}, 'runner/selector/task-manifest grammar'),
            ('boolean-wave', {'wave': True}, 'positive integer'),
            ('empty-steps', {'do_1': ''}, 'implementation steps'),
            ('missing-owner', {'owner': ''}, 'nonempty owner'),
            ('absolute-file-scope', {'touches': ['/tmp/unscoped.py']}, 'relative touches paths'),
            ('duplicate-case-selection', {'verify_cmd': template['verify_cmd'] + ' && ' + template['verify_cmd']}, 'duplicate acceptance selection'),
            ('cycle', {'requires': ['1.1']}, 'dependency cycle')]:
        altered = {'1.1': dict(template, **mutation)}
        observed = task_errors(altered, {'1.1'}, {'V-001'})
        checks.append({'fixture': name, 'expected_rejection_observed': any(expected in entry for entry in observed)})
    long_chain = {f'1.{number}': dict(template, requires=([f'1.{number-1}'] if number > 1 else []))
                  for number in range(1, 301)}
    checks.append({'fixture': 'valid-300-task-chain', 'expected_rejection_observed': not dependency_errors(long_chain)})
    later_wave = {'1.1': dict(template, requires=['1.2']), '1.2': dict(template, wave=2)}
    checks.append({'fixture': 'later-wave-prerequisite',
                   'expected_rejection_observed': any('later wave' in entry for entry in dependency_errors(later_wave))})
    checks.append({'fixture': 'unassigned-acceptance-case',
                   'expected_rejection_observed': any('without task qualification' in entry for entry in task_errors(good, {'1.1'}, {'V-001', 'V-002'}))})
    return checks


class Validator:
    def __init__(self, root: Path, output: Path, publication_policy: Path | None = None, mode: str = 'draft'):
        self.root, self.output = root.resolve(), output.resolve()
        self.errors, self.warnings, self.incomplete = [], [], []
        self.metrics, self.notes = {}, []
        self.json_documents = {}
        self.publication_policy = publication_policy
        if mode not in {'draft', 'implementation'}:
            raise ValueError('unknown validation mode')
        self.mode = mode

    def public_files(self, pattern: str):
        paths = []
        for path in sorted(self.root.rglob(pattern)):
            if 'private' in path.relative_to(self.root).parts or '__pycache__' in path.parts:
                continue
            if path.is_symlink():
                error = f'{path.relative_to(self.root)}: public pack artifact must not be a symbolic link'
                if error not in self.errors:
                    self.errors.append(error)
                continue
            paths.append(path)
        return paths

    def validate_privacy(self) -> None:
        # Generic patterns are portable. Optional local policy can add private
        # deployment-specific patterns without publishing those expressions.
        forbidden = [
            ('absolute-home-path', r'(?<![A-Za-z0-9_./-])/(?:root|home|Users)/[^\s)\]"<>]+'),
            ('raw-session-filename', r'rollout-\d{4}-\d{2}-\d{2}[^\s]*\.jsonl'),
            ('credential-format', r'\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b'),
        ]
        if self.publication_policy is not None:
            try:
                policy = strict_json(self.publication_policy.read_text())
                for number, item in enumerate(policy['patterns'], 1):
                    category = item.get('category', f'local-policy-{number}')
                    if not re.fullmatch(r'[a-z0-9_-]{1,64}', category):
                        raise ValueError('invalid category')
                    re.compile(item['regex'])
                    forbidden.append((category, item['regex']))
            except (OSError, ValueError, KeyError, TypeError, re.error):
                self.errors.append('Optional local publication policy is missing or invalid')
        self.metrics['optional_publication_policy_applied'] = self.publication_policy is not None
        raw_names = {'transcript.md', 'transcript-provenance.json', 'transcript-ledger.json'}
        inspected = 0
        for path in self.public_files('*'):
            if not path.is_file() or path.resolve() == self.output:
                continue
            if path.name in raw_names:
                self.errors.append(f'{path.relative_to(self.root)}: raw private audit artifact in public scope')
            if path.suffix not in {'.md', '.json', '.kvx', '.mmd', '.py', '.svg', '.html'}:
                continue
            inspected += 1
            in_denylist = False
            for number, line in enumerate(path.read_text().splitlines(), 1):
                if path == self.root / 'tools/validate_pack.py' and line.strip() == 'forbidden = [':
                    in_denylist = True
                if in_denylist:
                    if line.strip() == ']':
                        in_denylist = False
                    continue
                for category, pattern in forbidden:
                    if re.search(pattern, line, re.I):
                        self.errors.append(f'{path.relative_to(self.root)}:{number}: privacy marker category {category}')
        self.metrics['public_privacy_files_checked'] = inspected

    def needed(self, relative: str) -> Path | None:
        path = self.root / relative
        resolved = path.resolve()
        if path.is_symlink() or not resolved.is_relative_to(self.root) or 'private' in resolved.relative_to(self.root).parts:
            self.errors.append(f'{relative}: required artifact resolves outside the public pack')
            return None
        if not path.is_file():
            self.incomplete.append(f'awaiting required pack artifact: {relative}')
            return None
        if not path.read_bytes().strip():
            self.errors.append(f'empty required pack artifact: {relative}')
        return path

    def run(self) -> dict:
        for path in self.public_files('*.json'):
            if path.resolve() == self.output:
                continue
            try:
                self.json_documents[str(path.relative_to(self.root))] = strict_json(path.read_text())
            except (OSError, ValueError) as error:
                self.errors.append(f'{path.relative_to(self.root)}: invalid JSON: {error}')
        for relative in ['README.md', 'design.body.md', 'decisions.md', 'implementation-plan.md',
                         'requirements.md', 'verification.md', 'schematics.md', 'repository-baseline.md',
                         'storage.md', 'execution-contract.md', 'assurance.md', 'identity-security.md',
                         'migration.md', 'decision-models.md', 'providers/railway.md', 'providers/blaxel.md',
                         'evidence/task-catalog.json', 'evidence/traceability.json', 'evidence/native-lint.json',
                         'privacy.md', 'reviews/README.md']:
            self.needed(relative)
        sections = {}
        native = self.needed('spec.kvx')
        if native:
            try:
                sections = parse_kvx(native.read_text())
            except (OSError, InvalidKVX) as error:
                self.errors.append(f'spec.kvx: {error}')
        cases = self.validate_spec(sections)
        lint = self.json_documents.get('evidence/native-lint.json')
        if lint is not None:
            if lint.get('errors') != 0:
                self.errors.append('recorded native lint has errors or lacks an explicit zero-error result')
            lines = lint.get('report', '').splitlines()
            warning_lines = [line for line in lines if line.strip().startswith('warn')]
            if type(lint.get('warnings')) is not int or lint.get('warnings') != len(warning_lines):
                self.errors.append('recorded native lint warning count differs from preserved output')
            if any(not re.fullmatch(r'\s*warn\s+\S+\s+touches .+, which does not exist', line) for line in warning_lines):
                self.warnings.append('Native lint includes warnings beyond absent planned touch paths; inspect evidence/native-lint.json.')
            self.metrics['recorded_native_lint_errors'] = lint.get('errors')
            self.metrics['recorded_native_lint_warnings'] = lint.get('warnings')
            self.notes.append('Native lint is a separately recorded authoring check. Its absent planned-path warnings are preserved; this validator does not execute cg.')
        self.validate_traceability(sections, cases)
        self.validate_markdown_and_diagrams()
        self.validate_whitespace()
        self.validate_privacy()
        self.metrics['public_review_summaries'] = int((self.root / 'reviews/README.md').is_file())
        self.errors.extend(workflow_errors(self.root, self.mode))
        workflow = self.root.parent / 'workflow.kvx'
        if workflow.is_file():
            try:
                self.metrics['active_feature_observed'] = parse_kvx(workflow.read_text()).get('meta', {}).get('active_feature')
            except (OSError, InvalidKVX):
                pass
        fixtures = negative_self_tests()
        if not all(item['expected_rejection_observed'] for item in fixtures):
            self.errors.append('validator negative fixture or valid-control self-test failed')
        files = {}
        for path in self.public_files('*'):
            if path.is_file() and path.resolve() != self.output and '__pycache__' not in path.parts:
                files[str(path.relative_to(self.root))] = hashlib.sha256(path.read_bytes()).hexdigest()
        qualification_states = Counter(value.get('qualification', 'UNRUN') for name, value in sections.items() if name.startswith('acceptance.'))
        return {'schema_version': 1, 'scope': 'AUTHORING STRUCTURE ONLY', 'validation_mode': self.mode,
                'generated_at': datetime.now(timezone.utc).isoformat(),
                'status': 'FAIL' if self.errors else ('INCOMPLETE' if self.incomplete else 'PASS'),
                'runtime_acceptance_status': 'UNRUN' if set(qualification_states) <= {'UNRUN'} else 'DECLARED_STATES_ONLY',
                'declared_acceptance_states': dict(qualification_states), 'product_commands_executed': False,
                'live_state_authority': 'native spec.kvx during bootstrap; PostgreSQL after qualified cutover',
                'private_audit': 'NOT_VALIDATED_BY_PUBLIC_CHECK',
                'metrics': self.metrics, 'errors': self.errors, 'incomplete': self.incomplete,
                'warnings': self.warnings, 'notes': self.notes, 'validator_self_tests': fixtures,
                'limitations': [
                    'No product command, provider API, model API, infrastructure or load qualification is executed.',
                    'KVX validation covers the documented single-line JSON-value subset; native cg lint is a separate check.',
                    'Reference and coverage checks establish linkage, not semantic adequacy of prose, tests or architecture.',
                    'Private companion files are excluded from public requirements, scans, links and hashes; the original transcript audit is not claimed by this public check.',
                    'Same-wave collision detection checks exact file paths, not wildcard overlaps or undeclared/generated edits.',
                    'Mermaid source/embed equality is checked; diagram parsing, layout and rendering are not claimed.',
                    'HTTP links and local heading anchors are not verified; current vendor facts require the cited research.',
                    'Pack hashes identify inspected files; authoring the JSON report does not freeze later edits.'
                ], 'inspected_sha256': files}

    def validate_spec(self, sections: dict) -> set:
        meta = sections.get('meta', {})
        if meta.get('feature') != 'hyperfide':
            self.errors.append('spec.kvx: incorrect feature identity')
        if self.mode == 'draft':
            if (meta.get('status') != 'draft' or meta.get('implementation_authorized') is not False
                    or sections.get('execution', {}).get('state') != 'not_started'
                    or sections.get('execution', {}).get('approval_record')):
                self.errors.append('spec.kvx: draft mode requires draft and explicitly unapproved metadata')
        else:
            execution = sections.get('execution', {})
            if (meta.get('implementation_authorized') is not True or meta.get('status') not in {'in_progress', 'done'}
                    or execution.get('state') not in {'in_progress', 'completed'}
                    or not isinstance(execution.get('approval_record'), str) or not execution['approval_record'].strip()):
                self.errors.append('spec.kvx: implementation mode requires explicit approved native metadata and execution record')
            self.notes.append('Task catalog, traceability baseline and dated authoring reports are historical plans. Native KVX owns bootstrap live task state. Structural validation never certifies task or runtime qualification.')
        clauses = {f'{name[4:]}.{key[3:]}' for name, values in sections.items() if name.startswith('req.')
                   for key in values if re.fullmatch(r'ac_\d+', key)}
        expected_clauses = {f'{req}.{ac}' for req in range(1, 29) for ac in range(1, 5)}
        if clauses != expected_clauses:
            self.errors.append(f'spec.kvx: expected 112 clauses; missing={sorted(expected_clauses-clauses)}, extra={sorted(clauses-expected_clauses)}')
        tasks = {name[5:]: values for name, values in sections.items() if name.startswith('task.')}
        verification = self.root / 'verification.md'
        case_rows = re.findall(r'^\|\s*(V-\d{3})\s*\|', verification.read_text(), re.M) if verification.exists() else []
        cases = set(case_rows)
        if cases != {f'V-{number:03}' for number in range(1, 57)}:
            self.errors.append('verification must define exactly V-001 through V-056 in case tables')
        if len(case_rows) != len(cases):
            self.errors.append('verification contains duplicate acceptance case table rows')
        acceptance = {name[len('acceptance.'):]: values for name, values in sections.items() if name.startswith('acceptance.')}
        if not tasks:
            self.incomplete.append('native task sections not yet assembled')
        else:
            self.errors.extend(task_errors(tasks, clauses, cases, self.mode))
            if len(tasks) != 112:
                self.errors.append(f'expected 112 native implementation tasks, found {len(tasks)}')
        if not acceptance:
            self.incomplete.append('native acceptance sections not yet assembled')
        else:
            if set(acceptance) != cases:
                self.errors.append(f'native acceptance IDs differ from verification table: missing={sorted(cases-set(acceptance))}, extra={sorted(set(acceptance)-cases)}')
            for case, value in acceptance.items():
                allowed = {'UNRUN'} if self.mode == 'draft' else {'UNRUN', 'PASS', 'FAIL', 'BLOCKED'}
                if value.get('qualification') not in allowed:
                    self.errors.append(f'acceptance {case}: invalid qualification status for {self.mode} mode')
                if value.get('feature') != 'hyperfide':
                    self.errors.append(f'acceptance {case}: incorrect or missing feature')
                for field in ['scenario', 'expected', 'contract', 'test']:
                    if not isinstance(value.get(field), str) or not value[field].strip():
                        self.errors.append(f'acceptance {case}: missing nonempty {field}')
                unknown_reqs = set(value.get('reqs', [])) - clauses
                if not value.get('reqs') or unknown_reqs:
                    self.errors.append(f'acceptance {case}: missing or unknown requirement references: {sorted(unknown_reqs)}')
            covered = set().union(*(set(value.get('reqs', [])) for value in acceptance.values()))
            if clauses - covered:
                self.errors.append('requirements without native acceptance: ' + ', '.join(sorted(clauses - covered)))
        catalog = self.json_documents.get('evidence/task-catalog.json', {})
        if catalog.get('implementation_authorized') is not False:
            self.errors.append('task catalog must remain explicitly unapproved')
        catalog_tasks = {task['id']: task for task in catalog.get('tasks', [])}
        if catalog.get('task_count') != len(catalog_tasks):
            self.errors.append('task catalog declared count differs from entries')
        if catalog_tasks:
            if len(catalog_tasks) != len(catalog.get('tasks', [])):
                self.errors.append('task catalog: duplicate task IDs')
            if tasks and set(catalog_tasks) != set(tasks):
                self.errors.append('task catalog/native task IDs differ')
            for task_id in set(catalog_tasks) & set(tasks):
                item, native = catalog_tasks[task_id], tasks[task_id]
                fields = ['title', 'wave', 'requires', 'reqs', 'touches', 'verify_cmd', 'acceptance_ids', 'owner', 'artifacts', 'verification_scope']
                if self.mode == 'draft':
                    fields.append('status')
                if item.get('status') != 'pending':
                    self.errors.append(f'task {task_id}: planning baseline must remain pending')
                for field in fields:
                    if item.get(field) != native.get(field):
                        self.errors.append(f'task {task_id}: catalog/native {field} mismatch')
                native_steps = [native[key] for key in sorted((key for key in native if re.fullmatch(r'do_\d+', key)), key=lambda key: int(key[3:]))]
                if item.get('do_steps') != native_steps:
                    self.errors.append(f'task {task_id}: catalog/native implementation step mismatch')
                selections = set(re.findall(r'V-\d{3}', native.get('verify_cmd', '')))
                if set(item.get('acceptance_ids', [])) != selections:
                    self.errors.append(f'task {task_id}: catalog acceptance IDs/command mismatch')
        path_claims = defaultdict(list)
        for task_id, task in tasks.items():
            for touch in task.get('touches', []):
                if not any(char in touch for char in '*?['):
                    path_claims[(task.get('wave'), touch)].append(task_id)
        collisions = []
        def follows(task_id, predecessor):
            pending = list(tasks[task_id].get('requires', []))
            visited = set()
            while pending:
                item = pending.pop()
                if item == predecessor:
                    return True
                if item not in visited and item in tasks:
                    visited.add(item)
                    pending.extend(tasks[item].get('requires', []))
            return False

        for (wave, path), claimants in path_claims.items():
            for left, right in itertools.combinations(sorted(set(claimants)), 2):
                if not follows(left, right) and not follows(right, left):
                    collisions.append({'wave': wave, 'path': path, 'tasks': [left, right]})
        if collisions:
            self.errors.append(f'{len(collisions)} unordered same-wave exact-path collisions: {collisions}')
        self.metrics.update(requirement_clauses=len(clauses), native_tasks=len(tasks),
                            acceptance_cases=len(cases), native_acceptance_cases=len(acceptance),
                            task_catalog_entries=len(catalog_tasks), same_wave_exact_path_collisions=len(collisions))
        runner = self.root.parents[1] / 'tests/hyperfide/qualify.py'
        self.notes.append({'planned_product_runner': 'tests/hyperfide/qualify.py', 'exists': runner.exists(),
                           'executed': False, 'interpretation': 'Runner existence is reported only; no product verification or runtime qualification is executed by this structural check.'})
        return cases

    def validate_traceability(self, sections: dict, cases: set) -> None:
        trace = self.json_documents.get('evidence/traceability.json')
        if not trace:
            return
        if trace.get('schema_version') != 2 or trace.get('scope') != 'PUBLIC_IMPLEMENTATION_TRACEABILITY':
            self.errors.append('public traceability requires schema 2 PUBLIC_IMPLEMENTATION_TRACEABILITY')
        if trace.get('runtime_status') != 'UNRUN' or trace.get('implementation_authorized') is not False:
            self.errors.append('public traceability must remain UNRUN and explicitly unapproved')
        clauses = {f'{name[4:]}.{key[3:]}' for name, values in sections.items() if name.startswith('req.')
                   for key in values if re.fullmatch(r'ac_\d+', key)}
        tasks = {name[5:]: values for name, values in sections.items() if name.startswith('task.')}
        acceptance = {name[len('acceptance.'):]: values for name, values in sections.items() if name.startswith('acceptance.')}
        mappings = trace.get('clause_mappings', [])
        identifiers = [item.get('id') for item in mappings]
        if set(identifiers) != clauses or len(identifiers) != len(clauses):
            self.errors.append('public traceability must map each native clause exactly once')
        mapped_tasks, mapped_cases = set(), set()
        for item in mappings:
            identifier = item.get('id', '<missing>')
            selected_tasks = item.get('task_ids', [])
            selected_cases = item.get('acceptance_ids', [])
            chapters = item.get('chapters', [])
            if not selected_tasks or not selected_cases or not chapters:
                self.errors.append(f'traceability {identifier}: task/case/chapter linkage must be nonempty')
            for field, selected, known in [('task_ids', selected_tasks, tasks), ('acceptance_ids', selected_cases, cases)]:
                if len(selected) != len(set(selected)) or set(selected) - set(known):
                    self.errors.append(f'traceability {identifier}: duplicate or unknown {field}')
            derived_cases = set()
            for task_id in selected_tasks:
                if task_id in tasks:
                    if identifier not in tasks[task_id].get('reqs', []):
                        self.errors.append(f'traceability {identifier}: task {task_id} does not cover the mapped clause')
                    derived_cases.update(tasks[task_id].get('acceptance_ids', []))
            if tasks and set(selected_cases) != derived_cases:
                self.errors.append(f'traceability {identifier}: acceptance IDs differ from linked task selections')
            for case in selected_cases:
                if case in acceptance and identifier not in acceptance[case].get('reqs', []):
                    self.errors.append(f'traceability {identifier}: acceptance {case} does not cover the mapped clause')
            for chapter in chapters:
                relative = Path(chapter.split('#')[0])
                if relative.is_absolute() or 'private' in relative.parts or '..' in relative.parts:
                    self.errors.append(f'traceability {identifier}: chapter must be a portable public pack path')
                elif not (self.root / relative).is_file():
                    self.incomplete.append(f'traceability {identifier}: awaiting public chapter {relative}')
            mapped_tasks.update(selected_tasks)
            mapped_cases.update(selected_cases)
        if tasks and mapped_tasks != set(tasks):
            self.errors.append('public clause mappings do not cover every implementation task')
        if mapped_cases != cases:
            self.errors.append('public clause mappings do not cover every acceptance case')
        self.metrics['public_traceability_clauses'] = len(mappings)

    def validate_markdown_and_diagrams(self) -> None:
        broken = []
        link_count = 0
        for path in self.public_files('*.md'):
            text = re.sub(r'```[^\n]*\n.*?```', '', path.read_text(), flags=re.S)
            for match in re.finditer(r'(?<!!)\[[^\]\n]+\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)', text):
                target = match.group(1).strip('<>')
                if urlsplit(target).scheme or target.startswith('#'):
                    continue
                link_count += 1
                local = unquote(target.split('#', 1)[0])
                if re.search(r':\d+$', local):
                    local = re.sub(r':\d+$', '', local)
                resolved = (Path(local) if local.startswith('/') else path.parent / local).resolve()
                if resolved == self.output:
                    # This invocation writes its own report after inspection.
                    continue
                if resolved.is_relative_to(self.root) and 'private' in resolved.relative_to(self.root).parts:
                    self.errors.append(f'{path.relative_to(self.root)}: public link depends on private companion')
                elif not resolved.exists():
                    number = text.count('\n', 0, match.start()) + 1
                    broken.append(f'{path.relative_to(self.root)}:{number}: unresolved local target')
        self.incomplete.extend('awaiting local linked artifact: ' + entry for entry in broken)
        source_paths = [path for path in self.public_files('*.mmd') if path.parent == self.root / 'diagrams']
        schematic = self.root / 'schematics.md'
        embedded = re.findall(r'```mermaid\s*\n(.*?)```', schematic.read_text(), re.S) if schematic.exists() else []
        normalise = lambda value: '\n'.join(line.rstrip() for line in value.strip().splitlines())
        source_bodies = [normalise(path.read_text()) for path in source_paths]
        embed_bodies = [normalise(body) for body in embedded]
        if not source_paths:
            self.incomplete.append('no standalone Mermaid source diagrams')
        elif Counter(source_bodies) != Counter(embed_bodies):
            self.errors.append('standalone Mermaid sources differ from embedded schematics copies')
        self.metrics.update(local_markdown_links=link_count, unresolved_local_links=len(broken),
                            mermaid_sources=len(source_bodies), mermaid_embeds=len(embed_bodies))

    def validate_whitespace(self) -> None:
        failures = []
        for path in self.public_files('*'):
            if not path.is_file() or path.resolve() == self.output or path.suffix not in {'.md', '.mmd', '.json', '.kvx', '.py'}:
                continue
            content = path.read_text()
            for number, line in enumerate(content.splitlines(), 1):
                # Markdown's exactly-two-space hard line break is deliberate syntax.
                if line.rstrip() != line and not (path.suffix == '.md' and line.endswith('  ') and not line.endswith('   ')):
                    failures.append(f'{path.relative_to(self.root)}:{number}: trailing whitespace')
            if content and not content.endswith('\n'):
                failures.append(f'{path.relative_to(self.root)}: missing final newline')
        self.errors.extend(failures)


def private_audit(root: Path) -> str:
    """Opt-in provenance audit, with its findings kept in the private companion."""
    original = root.resolve() / 'private/original-pack'
    output = root.resolve() / 'private/evidence/private-validation.json'
    result = {'scope': 'PRIVATE PROVENANCE AUDIT ONLY', 'runtime_acceptance_status': 'UNRUN',
              'product_commands_executed': False, 'errors': [], 'warnings': [], 'metrics': {}}
    try:
        # Use the preserved original checker rather than exporting its private
        # transcript schema or source records into the public traceability map.
        module = runpy.run_path(str(original / 'tools/validate_pack.py'))
        checker = module['Validator'](original, output)
        for name in ['transcript-ledger.json', 'transcript-provenance.json', 'traceability.json']:
            checker.json_documents[f'evidence/{name}'] = strict_json((original / 'evidence' / name).read_text())
        sections = module['parse_kvx']((original / 'spec.kvx').read_text())
        cases = {name[len('acceptance.'):] for name in sections if name.startswith('acceptance.')}
        checker.validate_ledger()
        checker.validate_traceability(sections, cases)
        result.update(errors=checker.errors, warnings=checker.warnings,
                      incomplete=checker.incomplete, metrics=checker.metrics)
        result['status'] = 'FAIL' if checker.errors or checker.incomplete else 'PASS'
    except (OSError, ValueError, KeyError) as error:
        result['errors'].append(f'Private companion cannot be audited: {type(error).__name__}')
        result['status'] = 'FAIL'
    result['generated_at'] = datetime.now(timezone.utc).isoformat()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    return result['status']


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, help='Defaults to a mode-specific structural report; historical authoring report is retained')
    parser.add_argument('--mode', choices=['draft', 'implementation'], default='draft')
    parser.add_argument('--publication-policy', type=Path, help='Optional local regex policy JSON; expressions are never copied into the public report')
    parser.add_argument('--private-audit', action='store_true', help='Also audit optional preserved provenance; detailed output stays inside private/evidence/')
    args = parser.parse_args()
    output = args.output or args.root / ('evidence/pack-validation.json' if args.mode == 'draft' else 'evidence/implementation-validation.json')
    if args.mode == 'implementation' and output.resolve() in {(args.root / 'evidence/pack-validation.json').resolve(), (args.root / 'evidence/native-lint.json').resolve()}:
        parser.error('implementation checks must not overwrite historical authoring evidence')
    report = Validator(args.root, output, args.publication_policy, args.mode).run()
    private_status = private_audit(args.root) if args.private_audit else None
    if args.private_audit:
        report['private_audit'] = 'RECORDED_SEPARATELY'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({key: report[key] for key in ['status', 'scope', 'metrics', 'errors', 'incomplete', 'warnings']}, indent=2))
    return 1 if report['status'] == 'FAIL' or private_status == 'FAIL' else (2 if report['status'] == 'INCOMPLETE' else 0)


if __name__ == '__main__':
    sys.exit(main())
