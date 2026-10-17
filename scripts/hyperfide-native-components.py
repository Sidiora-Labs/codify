#!/usr/bin/env python3
"""Validate task-owned native components and emit a deterministic linked registry."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
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
        'optional_fields': ['requires', 'support_sources', 'headers', 'libraries', 'native_dependencies'],
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
        if not required <= set(item) or set(item) - required - set(expected['optional_fields']):
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
        for field, suffix in [('support_sources', '.c'), ('headers', '.h')]:
            paths = item.setdefault(field, [])
            if not isinstance(paths, list) or any(not isinstance(value, str) for value in paths) or len(paths) != len(set(paths)):
                raise ValueError('invalid or duplicate native support paths')
            for value in paths:
                if not re.fullmatch(r'src/hyperfide/[A-Za-z0-9_./-]+[.]' + suffix[1:], value) or Path(value).name == 'component_main.c':
                    raise ValueError('native support path must be a repository native source/header without standalone main')
                contained(root, Path(value))
            if field == 'support_sources' and item['source'] in paths:
                raise ValueError('component source duplicated as support source')
        libraries = item.setdefault('libraries', [])
        if not isinstance(libraries, list) or len(libraries) != len(set(libraries)) or any(not isinstance(value, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', value) for value in libraries):
            raise ValueError('invalid native link library declaration')
        dependencies = item.setdefault('native_dependencies', {})
        if not isinstance(dependencies, dict) or set(dependencies) - set(libraries):
            raise ValueError('native dependency must describe a declared link library')
        for declaration in dependencies.values():
            if not isinstance(declaration, dict) or not {'pkg_config', 'minimum', 'header', 'header_macro'} <= set(declaration) or set(declaration) - set(DEPENDENCY_FIELDS):
                raise ValueError('invalid native dependency declaration')
            if any(not isinstance(value, str) or not re.fullmatch(DEPENDENCY_FIELDS[key], value) for key, value in declaration.items()):
                raise ValueError('invalid native dependency declaration value')
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

DEPENDENCY_FIELDS = {
    'pkg_config': r'[A-Za-z0-9_.+-]{1,64}',
    'minimum': r'[0-9]+[.][0-9]+[.][0-9]+',
    'header': r'[A-Za-z0-9_/-]{1,96}[.]h',
    'header_macro': r'[A-Z][A-Z0-9_]{0,63}',
    'tls_backend': r'[A-Za-z0-9_-]{1,32}',
    'debian_development': r'[a-z0-9][a-z0-9.+-]{0,63}',
    'debian_runtime': r'[a-z0-9][a-z0-9.+-]{0,63}',
}

def version_tuple(text):
    match = re.match(r'([0-9]+)[.]([0-9]+)(?:[.]([0-9]+))?', text or '')
    return tuple(int(part or 0) for part in match.groups()) if match else None

def tool(argv, stdin=None):
    try:
        result = subprocess.run(argv, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None

def package(name):
    if not name or not shutil.which('dpkg-query'):
        return None
    version = tool(['dpkg-query', '-W', '-f=${Version}', name])
    return {'name': name, 'version': version} if version else {'name': name, 'version': None}

def resolve(library, declaration):
    """Observe the actual development/runtime prerequisite and enforce its minimum."""
    module = declaration['pkg_config']
    observed = {'library': library, **declaration}
    observed['pkg_config_version'] = tool(['pkg-config', '--modversion', module])
    observed['cflags'] = tool(['pkg-config', '--cflags', module])
    observed['libs'] = tool(['pkg-config', '--libs', module])
    compiler = os.environ.get('CC') or 'cc'
    macros = tool([compiler, *(observed['cflags'] or '').split(), '-E', '-dM', '-include', declaration['header'], '-x', 'c', '-'], '') or ''
    header = re.search(r'^#define ' + re.escape(declaration['header_macro']) + r' "([^"]+)"', macros, re.M)
    observed['header_version'] = header[1] if header else None
    problems = []
    minimum = version_tuple(declaration['minimum'])
    for key in ('pkg_config_version', 'header_version'):
        actual = version_tuple(observed[key])
        if actual is None or actual < minimum:
            problems.append(key + ' below ' + declaration['minimum'])
    if observed['pkg_config_version'] and observed['header_version'] and version_tuple(observed['pkg_config_version']) != version_tuple(observed['header_version']):
        problems.append('pkg-config and header versions differ')
    if 'tls_backend' in declaration:
        backends = tool(['curl-config', '--ssl-backends'])
        observed['tls_backends'] = sorted(part.strip() for part in (backends or '').split(',') if part.strip())
        if declaration['tls_backend'] not in observed['tls_backends']:
            problems.append('qualified TLS backend ' + declaration['tls_backend'] + ' unavailable')
    observed['development_package'] = package(declaration.get('debian_development'))
    observed['runtime_package'] = package(declaration.get('debian_runtime'))
    observed['problems'] = problems
    observed['qualified'] = not problems
    return observed

def link_contract(items):
    """Source/link contract shared by the native runner and the public CLI build."""
    dependencies = {}
    for item in items:
        for library, declaration in sorted(item['native_dependencies'].items()):
            if library in dependencies and dependencies[library]['declared'] != declaration:
                raise ValueError('conflicting native dependency declarations for ' + library)
            dependencies.setdefault(library, {'declared': declaration})
    resolved = {library: resolve(library, value['declared']) for library, value in sorted(dependencies.items())}
    return {
        'schema_version': 1,
        'sources': sorted({path for item in items for path in [item['source'], *item['support_sources']]}),
        'headers': sorted({path for item in items for path in item['headers']}),
        'libraries': ['-l' + library for library in sorted({library for item in items for library in item['libraries']})],
        'standalone_mains_excluded': ['src/hyperfide/component_main.c'],
        'components': [{'id': item['id'], 'entry': item['entry'], 'actions': item['actions']} for item in items],
        'dependencies': resolved,
        'status': 'PASS' if all(value['qualified'] for value in resolved.values()) else 'FAIL',
    }

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
    parser.add_argument('--headers', action='store_true')
    parser.add_argument('--libraries', action='store_true')
    parser.add_argument('--link-contract', action='store_true')
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
        if args.link_contract:
            contract = link_contract(items)
            print(json.dumps(contract, sort_keys=True))
            if contract['status'] != 'PASS':
                raise ValueError('native link prerequisites unqualified: ' + '; '.join(f'{name}: {problem}' for name, value in contract['dependencies'].items() for problem in value['problems']))
        elif args.sources:
            print(' '.join(sorted({path for item in items for path in [item['source'], *item['support_sources']]})))
        elif args.headers:
            print(' '.join(sorted({path for item in items for path in item['headers']})))
        elif args.libraries:
            print(' '.join('-l' + library for library in sorted({library for item in items for library in item['libraries']})))
        else:
            print(json.dumps({'schema_version': 1, 'components': len(items), 'status': 'PASS'}))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f'native component validation failed: {error}', file=sys.stderr)
        return 2

if __name__ == '__main__':
    sys.exit(main())
