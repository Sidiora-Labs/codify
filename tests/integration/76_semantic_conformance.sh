#!/usr/bin/env bash
# Source-labelled extraction and full graph-set convergence gates.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1

here="$(cd "$(dirname "$0")/../.." && pwd)"
cg_bin="${CG:-$here/cg}"
out="${CG_SEMANTIC_REPORT_DIR:-$(mktemp -d)}"
mkdir -p "$out"

python3 "$here/tests/semantic/run.py" --cg "$cg_bin" \
    --out "$out/labels.json"
python3 "$here/tests/semantic/convergence.py" --cg "$cg_bin" \
    --out "$out/convergence.json"
echo "76_semantic_conformance ok — reports: $out"
