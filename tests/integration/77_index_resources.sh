#!/usr/bin/env bash
# Deterministic small resource profile. The large profile is opt-in through
# scripts/bench-indexing.py --profile large, never part of the default suite.
. "$(dirname "$0")/../lib.sh"

HERE="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$TMP/index-resources.json"
python3 "$HERE/scripts/bench-indexing.py" --cg "$CG" \
    --files 20 --lines 700 --seed 15 --workers 2 \
    --max-rss-mb 1024 --max-db-ratio 500 --output "$OUT" >/dev/null

python3 - "$OUT" "$HERE" <<'PY'
import importlib.util
import json
import sys
from pathlib import Path
sys.dont_write_bytecode = True

d = json.loads(Path(sys.argv[1]).read_text())
assert d['format'] == 'codify-index-benchmark-v1'
assert d['fixture']['files'] == 20 and d['fixture']['seed'] == 15
assert d['fixture']['source_bytes'] > 0
assert d['settings']['workers'] == 2
assert len(d['runtime']['binary_sha256']) == 64
assert d['runtime']['profile'] and d['runtime']['sqlite']
assert not d['regressions'], d['regressions']
assert d['source_to_query_ms'] >= d['stages']['edit']['wall_ms']
assert d['stages']['cold']['database']['main_bytes'] > 0
assert d['stages']['cold']['child_peak_rss_kb'] is not None
for name in ('noop', 'edit', 'delete', 'rename', 'replay_back',
             'replay_forward', 'full'):
    s = d['stages'][name]
    assert s['wall_ms'] >= 0 and s['stats']['workers'] <= 2, (name, s)
    assert set(s['stats']['phase_ms']) == {'walk', 'parse', 'write',
                                           'resolve', 'soft'}, name
    assert s['stats']['peak_rss_kb'] > 0, name
    assert s['database']['main_bytes'] > 0, name
    assert s['coverage']['available'], (name, s['coverage'])
    assert 'diagnostic_files' in s['coverage'], name
assert d['stages']['noop']['stats']['indexed'] == 0
assert d['stages']['edit']['stats']['indexed'] >= 1
assert d['stages']['delete']['stats']['removed'] >= 1
assert d['stages']['rename']['stats']['removed'] >= 1
assert d['stages']['replay_back']['stats']['indexed'] >= 1
assert d['stages']['replay_forward']['stats']['indexed'] >= 1

# Baseline regression reporting is a real gate, independent of host speed.
spec = importlib.util.spec_from_file_location(
    'bench_indexing', Path(sys.argv[2]) / 'scripts/bench-indexing.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
baseline = {'stages': {'noop': {'wall_ms': 1,
                               'stats': {'peak_rss_kb': 1}}}}
findings = mod.compare_baseline(d, baseline, 1.1, 1)
assert any(f['metric'] == 'wall_ms' for f in findings), findings
assert any(f['metric'] == 'peak_rss_kb' for f in findings), findings
PY

# A deliberately impossible memory cap must fail with measured evidence.
LOW="$TMP/low-cap.json"
rc=0
python3 "$HERE/scripts/bench-indexing.py" --cg "$CG" \
    --files 20 --lines 700 --workers 1 --max-rss-mb 1 \
    --output "$LOW" >/dev/null || rc=$?
[ "$rc" -eq 1 ] || fail "memory cap returned $rc"
python3 - "$LOW" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert any('peak RSS' in str(x) for x in d['regressions']), d['regressions']
PY

echo 'index resources: ok'
