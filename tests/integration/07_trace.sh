#!/usr/bin/env bash
# Phase 3: graph-verified task completion (symbols/touches) + cg spec trace
. "$(dirname "$0")/../lib.sh"

# ---- no .codegraph: declared checks all fail closed ----
cp -r "$FIXTURES/specrepo" "$TMP/nograph"
cd "$TMP/nograph"
"$CG" spec start 1.2 >/dev/null
touch verify.marker
"$CG" spec done 1.2 >/dev/null
"$CG" spec start 2.1 >/dev/null
rc=0; out="$("$CG" spec done 2.1 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "done without a graph should refuse (rc=$rc)"
has "$out" "run \`cg init\` first"
has "$out" "NOT marked done"

# ---- full flow with a graph ----
cp -r "$FIXTURES/specrepo" "$TMP/repo"
cd "$TMP/repo"
"$CG" init >/dev/null
"$CG" commit -m "baseline" >/dev/null

"$CG" spec start 1.2 >/dev/null
touch verify.marker
"$CG" spec done 1.2 >/dev/null
"$CG" spec start 2.1 >/dev/null

# 2.1 declares symbols=["checkMode"] touches=["src/*.ts"] — nothing exists yet
rc=0; out="$("$CG" spec done 2.1 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "done should refuse when graph checks fail (rc=$rc)"
has "$out" "graph checks:"
has "$out" "✗ symbol checkMode — not defined in the graph"
has "$out" "✗ touched src/*.ts"
has "$out" "NOT marked done"
out="$("$CG" spec status)"
has "$out" "1 in progress"

# write the code, commit it (auto-tagged with the in-progress task) so the
# worktree is clean — attribution must come from the tagged commit
mkdir -p src
cat > src/check.ts <<'EOF'
export function checkMode(stale: number): number {
  return stale > 0 ? 2 : 0;
}
EOF
out="$("$CG" commit -m "wip" 2>&1)"
has "$out" "[spec:demo/2.1]"
out="$("$CG" status)"
has "$out" "clean"

out="$("$CG" spec done 2.1 2>&1)"
has "$out" "✓ symbol checkMode"
has "$out" "src/check.ts"
has "$out" "✓ touched src/*.ts"
has "$out" "done 2.1 — Check mode"
out="$("$CG" spec status)"
has "$out" "3 done"

# --force overrides failing checks: give 1.1 an impossible symbol
python3 - <<'EOF'
import re
p = "spec/demo/spec.kvx"
s = open(p).read()
s = s.replace('[task.1.1]\ntitle  = "Parse kvx files"\nstatus = "done"',
              '[task.1.1]\ntitle  = "Parse kvx files"\nstatus = "pending"\nsymbols = ["noSuchSymbolXyz"]')
open(p, "w").write(s)
EOF
rc=0; "$CG" spec done 1.1 >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 1 ] || fail "done 1.1 should refuse on missing symbol (rc=$rc)"
rc=0; out="$("$CG" spec done 1.1 --force 2>&1)" || rc=$?
[ "$rc" -eq 0 ] || fail "--force should override failed graph checks (rc=$rc)"
has "$out" "--force"

# ---- trace: one task ----
out="$("$CG" spec trace 2.1)"
has "$out" "task 2.1 — Check mode [done]"
has "$out" "✓ checkMode"
has "$out" "src/check.ts"
has "$out" "✓ src/*.ts"
has "$out" "wip [spec:demo/2.1]"

# unknown task id
expect_rc 1 "$CG" spec trace 9.9

# ---- trace: overview covers every leaf task ----
out="$("$CG" spec trace)"
has "$out" "feature: demo"
has "$out" "task 1.1"
has "$out" "task 1.2"
has "$out" "task 2.1"
has "$out" "nothing declared"   # 1.2 has no symbols/touches/tagged commits

# ---- trace --json ----
"$CG" spec trace 2.1 --json | python3 -c "
import json, sys
t = json.load(sys.stdin)['task']
assert t['id'] == '2.1' and t['status'] == 'done', t
assert t['graph'] is True, t
s = t['symbols'][0]
assert s['name'] == 'checkMode' and s['found'] is True, s
assert s['path'] == 'src/check.ts' and s['line'] >= 1, s
tc = t['touches'][0]
assert tc['pattern'] == 'src/*.ts' and tc['changed'] is True, tc
assert len(t['commits']) == 1, t['commits']
assert '[spec:demo/2.1]' in t['commits'][0]['message'], t['commits']
"

"$CG" spec trace --json | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d['feature'] == 'demo' and d['graph'] is True, d
ids = [t['id'] for t in d['tasks']]
assert ids == ['1.1', '1.2', '2.1'], ids
"

# Qualified Rust paths resolve their short graph symbols and disambiguate
# duplicate function names using the declared crate/module path.
cat >> spec/demo/spec.kvx <<'EOF'

[task.3.1]
title    = "Verify qualified Rust symbols"
status   = "pending"
wave     = 3
requires = ["2.1"]
symbols  = ["layerx_crypto::ed25519::verify", "layerx_crypto::secp256k1::verify"]
touches  = ["agent/crates/layerx-crypto/src/*.rs"]
EOF
mkdir -p agent/crates/layerx-crypto/src
cat > agent/crates/layerx-crypto/src/ed25519.rs <<'EOF'
pub fn verify(bytes: &[u8]) -> bool {
    !bytes.is_empty()
}
EOF
cat > agent/crates/layerx-crypto/src/secp256k1.rs <<'EOF'
pub fn verify(bytes: &[u8]) -> bool {
    bytes.len() > 1
}
EOF
"$CG" spec start 3.1 >/dev/null
"$CG" commit -m "qualified rust symbols" >/dev/null
out="$("$CG" spec done 3.1 2>&1)"
has "$out" "layerx_crypto::ed25519::verify  function  agent/crates/layerx-crypto/src/ed25519.rs"
has "$out" "layerx_crypto::secp256k1::verify  function  agent/crates/layerx-crypto/src/secp256k1.rs"
"$CG" spec trace 3.1 --json | python3 -c "
import json, sys
symbols = json.load(sys.stdin)['task']['symbols']
assert [s['found'] for s in symbols] == [True, True], symbols
assert [s['path'] for s in symbols] == [
    'agent/crates/layerx-crypto/src/ed25519.rs',
    'agent/crates/layerx-crypto/src/secp256k1.rs',
], symbols
"

echo ok
