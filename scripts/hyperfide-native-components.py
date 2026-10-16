#!/usr/bin/env python3
"""Validate task-owned native components and emit a deterministic linked registry."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile

def parse(text):
    result, current = {}, None
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        section = re.fullmatch(r'\[([A-Za-z0-9_.-]+)\]', line)
        if section:
            key = section[1]
            if key in result:
                raise ValueError(f'duplicate section at line {number}')
            current = result[key] = {}
            continue
        assignment = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)', line)
        if current is None or not assignment:
            raise ValueError(f'invalid KVX at line {number}')
        key, value = assignment.groups()
        if key in current:
            raise ValueError(f'duplicate key at line {number}')
        current[key] = json.loads(value)
    return result

def contained(root, path, required=True):
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('component path must be repository relative')
    full = root / path
    for part in [full, *full.parents]:
        if part == root.parent:
            break
        if part.is_symlink():
            raise ValueError('symlink component paths are forbidden')
    if not full.resolve().is_relative_to(root):
        raise ValueError('component path escapes repository')
    if required and not full.is_file():
        raise ValueError('component source is missing')
    return full

def inventory(root):
    folder = root / 'src/hyperfide/components'
    schema_file = contained(root, Path('src/hyperfide/components/schema.kvx'))
    schema = parse(schema_file.read_text())
    expected = {
        'version': 1,
        'required_fields': ['schema_version', 'id', 'source', 'entry', 'actions'],
        'optional_fields': ['requires'],
        'callback': 'int entry(const char *action, const char *request_json, FILE *output)',
    }
    if type(schema.get('schema', {}).get('version')) is not int or schema != {'schema': expected}:
        raise ValueError('unsupported native component schema')
    components, entries, ids = [], set(), set()
    for file in sorted(folder.glob('*.kvx')):
        if file.name == 'schema.kvx':
            continue
        contained(root, file.relative_to(root))
        parsed = parse(file.read_text())
        if set(parsed) != {'component'}:
            raise ValueError('fragment must contain exactly [component]')
        item = parsed['component']
        required = set(expected['required_fields'])
        if not required <= set(item) or set(item) - required - {'requires'}:
            raise ValueError('missing or unknown component fields')
        if type(item['schema_version']) is not int or item['schema_version'] != 1:
            raise ValueError('unsupported component schema version')
        if not isinstance(item['id'], str) or not re.fullmatch(r'[0-9]+\.[0-9]+', item['id']):
            raise ValueError('invalid native component ID')
        if item['id'] in ids:
            raise ValueError('duplicate native component ID')
        ids.add(item['id'])
        if not isinstance(item['entry'], str) or not re.fullmatch(r'hf_component_[A-Za-z0-9_]+', item['entry']):
            raise ValueError('invalid native entry symbol')
        if item['entry'] in entries:
            raise ValueError('duplicate native entry symbol')
        entries.add(item['entry'])
        if not isinstance(item['source'], str):
            raise ValueError('invalid component source')
        source = Path(item['source'])
        if not re.fullmatch(r'src/hyperfide/[A-Za-z0-9_./-]+[.]c', item['source']) or source.suffix != '.c' or source.name == 'component_main.c':
            raise ValueError('source must be a native component C module')
        contained(root, source)
        actions = item['actions']
        if not isinstance(actions, list) or not actions or any(not isinstance(x, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,127}', x) for x in actions) or len(actions) != len(set(actions)):
            raise ValueError('invalid or duplicate component actions')
        requires = item.setdefault('requires', [])
        if not isinstance(requires, list) or any(not isinstance(x, str) or not re.fullmatch(r'[0-9]+\.[0-9]+', x) for x in requires) or len(requires) != len(set(requires)):
            raise ValueError('invalid component dependencies')
        components.append(item)
    by_id = {item['id']: item for item in components}
    incoming = {key: len(item['requires']) for key, item in by_id.items()}
    for item in components:
        if set(item['requires']) - set(by_id):
            raise ValueError('missing native component dependency')
    ready = sorted(key for key, degree in incoming.items() if not degree)
    seen = []
    while ready:
        key = ready.pop(0)
        seen.append(key)
        for item in components:
            if key in item['requires']:
                incoming[item['id']] -= 1
                if incoming[item['id']] == 0:
                    ready.append(item['id'])
                    ready.sort()
    if len(seen) != len(components):
        raise ValueError('native component dependency cycle')
    return [by_id[key] for key in seen]

def generate(items):
    lines = ['/* Generated by scripts/hyperfide-native-components.py. */']
    for item in items:
        lines.append(f'extern int {item["entry"]}(const char *, const char *, FILE *);')
    lines.append('static const HfNativeAction hf_native_actions[] = {')
    for item in items:
        for action in item['actions']:
            lines.append('    {' + json.dumps(item['id']) + ', ' + json.dumps(action) + ', ' + item['entry'] + '},')
    lines.extend(['    {NULL, NULL, NULL}', '};', ''])
    return '\n'.join(lines)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--generate', type=Path)
    parser.add_argument('--sources', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        items = inventory(root)
        if args.generate:
            output = contained(root, args.generate, False)
            output.parent.mkdir(parents=True, exist_ok=True)
            content = generate(items)
            if not output.exists() or output.read_text() != content:
                with tempfile.NamedTemporaryFile('w', dir=output.parent, delete=False) as stream:
                    stream.write(content)
                    temporary = stream.name
                try:
                    os.replace(temporary, output)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
        if args.sources:
            print(' '.join(sorted({item['source'] for item in items})))
        else:
            print(json.dumps({'schema_version': 1, 'components': len(items), 'status': 'PASS'}))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f'native component validation failed: {error}', file=sys.stderr)
        return 2

if __name__ == '__main__':
    sys.exit(main())
