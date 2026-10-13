#!/usr/bin/env bash
# bench.sh — the index at scale, measured (codify-v15 3). Generates the
# scale fixture (tests/scale/gen.py, default 20000 files / ~2M lines) in a
# temporary git repository and times cg init, a no-change sync, a one-file
# sync under each walk mode, and the read commands (grep, files, context —
# whichever this build has). Prints a markdown table for docs/sync.md.
#
#   scripts/bench.sh [--files N] [--lines L] [--cg PATH] [--keep DIR]
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
CGB="$here/cg"
FILES=20000
LINES=2000000
KEEP=""
while [ $# -gt 0 ]; do
    case "$1" in
        --files) FILES="$2"; shift 2 ;;
        --lines) LINES="$2"; shift 2 ;;
        --cg)    CGB="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
        --keep)  KEEP="$2"; shift 2 ;;
        *) echo "usage: $0 [--files N] [--lines L] [--cg PATH] [--keep DIR]" >&2; exit 2 ;;
    esac
done
[ -x "$CGB" ] || { echo "bench: no cg at $CGB (make cg)" >&2; exit 1; }

if [ -n "$KEEP" ]; then D="$KEEP"; mkdir -p "$D"; else
    D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT
fi
P="$D/proj"
rm -rf "$P"
gen="$(python3 "$here/tests/scale/gen.py" "$P" --files "$FILES" --lines "$LINES")"
read -r nfiles _ nlines _ nbytes _ <<<"$gen"
cd "$P"
git init -q .
git add -A
git -c user.email=bench@codify -c user.name=bench commit -qm bench

ms() { echo $(( ($(date +%s%N) - $1) / 1000000 )); }
jget() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2"; }
has_cmd() { "$CGB" help 2>&1 | grep -q "^  $1 "; }
rows=()
row() { rows+=("| $1 | $2 | $3 |"); }

t=$(date +%s%N); "$CGB" init >/dev/null 2>&1; init_ms=$(ms "$t")
db=$(stat -c %s .codegraph/graph.db)
row "cg init" "${init_ms} ms" "$((nfiles * 1000 / (init_ms + 1))) files/s, $((nlines * 1000 / (init_ms + 1))) lines/s"

t=$(date +%s%N); d="$("$CGB" sync --json)"; m=$(ms "$t")
row "cg sync, nothing changed (walk: $(jget "$d" 'd["walk"]'))" "${m} ms" "walk $(jget "$d" 'd["phase_ms"]["walk"]') ms"

one="$(find g00 -name '*.go' | sort | head -1)"
printf '\nfunc BenchEdited() int { return 1 }\n' >> "$one"
t=$(date +%s%N); d="$("$CGB" sync --json)"; m=$(ms "$t")
row "cg sync, one file edited (walk: $(jget "$d" 'd["walk"]'))" "${m} ms" "phases $(jget "$d" 'd["phase_ms"]')"

printf '[index]\nwalk = git\n' > codify.kvx
"$CGB" sync >/dev/null
t=$(date +%s%N); d="$("$CGB" sync --json)"; m=$(ms "$t")
row "cg sync, nothing changed (walk: $(jget "$d" 'd["walk"]'))" "${m} ms" "walk = git"
printf '\nfunc BenchEditedAgain() int { return 2 }\n' >> "$one"
t=$(date +%s%N); d="$("$CGB" sync --json)"; m=$(ms "$t")
row "cg sync, one file edited (walk: $(jget "$d" 'd["walk"]'))" "${m} ms" "walk = git"
rm -f codify.kvx

t=$(date +%s%N); d="$("$CGB" index --full --json)"; m=$(ms "$t")
rss=$(jget "$d" 'd["peak_rss_kb"]')
row "cg index --full" "${m} ms" "peak RSS $((rss / 1024)) MB; phases $(jget "$d" 'd["phase_ms"]')"

if has_cmd grep; then
    t=$(date +%s%N); "$CGB" grep scale_marker_12345 >/dev/null; row "cg grep (literal)" "$(ms "$t") ms" "one file holds it"
    t=$(date +%s%N); "$CGB" grep 'scale_marker_1234[0-9]' >/dev/null; row "cg grep (regex)" "$(ms "$t") ms" ""
else
    row "cg grep" "—" "not in this build"
fi
if has_cmd files; then
    t=$(date +%s%N); "$CGB" files 'g01/**' >/dev/null; row "cg files" "$(ms "$t") ms" "a glob over one group"
else
    row "cg files" "—" "not in this build"
fi
t=$(date +%s%N); "$CGB" context scale_marker_12345 >/dev/null 2>&1 || true
row "cg context (a literal)" "$(ms "$t") ms" ""
t=$(date +%s%N); "$CGB" search Scale >/dev/null 2>&1 || true
row "cg search" "$(ms "$t") ms" ""

profile="$("$CGB" info | sed -n 's/^machine profile: //p')"
cores="$("$CGB" info | sed -n 's/^ *cores: .*-> //p')"
fts="$(jget "$("$CGB" info --json)" 'd["fts_mode"]')"
sqlv="$(jget "$("$CGB" info --json)" 'd["sqlite"]')"

echo "Profile: ${profile:-unknown} (${cores:-?}), SQLite $sqlv, body index $fts."
echo "Fixture: $nfiles files, $nlines lines, $nbytes bytes; database $db bytes ($(python3 -c "print(round($db/$nbytes,2))") per source byte)."
echo
echo "| Operation | Time | Notes |"
echo "|---|---|---|"
printf '%s\n' "${rows[@]}"
