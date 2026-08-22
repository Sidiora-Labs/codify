#!/usr/bin/env bash
# root resolution boundaries, init guards, cg root, .gitignore
. "$(dirname "$0")/../lib.sh"

# ---- an ancestor project must not capture a directory behind a .git boundary
mkdir -p "$TMP/outer/inner/proj/src" "$TMP/outer/.codegraph/objects"
mkdir -p "$TMP/outer/inner/proj/.git"
echo 'function inner(){}' > "$TMP/outer/inner/proj/src/a.js"
echo 'outer-only' > "$TMP/outer/notes.txt"

cd "$TMP/outer/inner/proj"
expect_rc 1 "$CG" root                      # .git stops the walk
out="$("$CG" status 2>&1 || true)"
hasnt "$out" "notes.txt"                    # never bind the ancestor's tree

out="$("$CG" init)"
has "$out" "initialized"
out="$("$CG" root)"
has "$out" "$TMP/outer/inner/proj"

# ---- a plain nested directory warns and requires --nested
mkdir -p "$TMP/outer/plain/sub"
cd "$TMP/outer/plain/sub"
out="$("$CG" root)"
has "$out" "$TMP/outer"                     # resolves to the ancestor
out="$("$CG" init 2>&1 || true)"
has "$out" "already a Codify project"
has "$out" "--nested"
out="$("$CG" init --nested)"
has "$out" "initialized"
out="$("$CG" root)"
has "$out" "$TMP/outer/plain/sub"

# ---- init refuses $HOME without --force
mkdir -p "$TMP/fakehome"
( cd "$TMP/fakehome" && HOME="$TMP/fakehome" "$CG" init 2>&1 || true ) \
    | grep -qF "home directory" || fail "init should refuse \$HOME"

# ---- $HOME stops the upward walk
mkdir -p "$TMP/fakehome/.codegraph/objects" "$TMP/fakehome/kid/grandkid"
out="$(cd "$TMP/fakehome/kid/grandkid" && HOME="$TMP/fakehome" "$CG" root)"
has "$out" "$TMP/fakehome"
out="$(cd "$TMP/fakehome/kid" && HOME="$TMP/fakehome/kid" "$CG" root 2>&1 || true)"
has "$out" "no Codify project"

# ---- CODIFY_ROOT overrides resolution
out="$(cd "$TMP" && CODIFY_ROOT="$TMP/outer" "$CG" root)"
has "$out" "$TMP/outer"

# ---- cg info names the bound project
cd "$TMP/outer/inner/proj"
out="$("$CG" info)"
has "$out" "project root: $TMP/outer/inner/proj"
out="$("$CG" info --json)"
has "$out" '"root"'

# ---- .gitignore is honoured, with negation
cd "$TMP/outer/inner/proj"
mkdir -p logs keep
printf 'logs/\n*.tmp\n!keep/important.tmp\n' > .gitignore
echo 'noise' > logs/a.js
echo 'noise' > scratch.tmp
echo 'keepme' > keep/important.tmp
"$CG" index --full >/dev/null
out="$("$CG" status)"
hasnt "$out" "logs/a.js"
hasnt "$out" "scratch.tmp"
has   "$out" "keep/important.tmp"

# ---- .cgignore still overrides on top of .gitignore
printf 'keep\n' > .cgignore
"$CG" index --full >/dev/null
out="$("$CG" status)"
hasnt "$out" "keep/important.tmp"

echo "09_root ok"

# ---- nested .gitignore applies only beneath its own directory
cd "$TMP/outer/inner/proj"
rm -f .cgignore
mkdir -p pkg/a pkg/b
printf 'skipme.js\n' > pkg/a/.gitignore
echo 'x' > pkg/a/skipme.js
echo 'y' > pkg/b/skipme.js
"$CG" index --full >/dev/null
out="$("$CG" status)"
hasnt "$out" "pkg/a/skipme.js"
has   "$out" "pkg/b/skipme.js"

echo "09_root nested ok"

# ---- CODIFY_ROOT pointing at a non-project fails rather than falling back
mkdir -p "$TMP/notaproject"
out="$(cd "$TMP/outer/inner/proj" && CODIFY_ROOT="$TMP/notaproject" \
       "$CG" root 2>&1 || true)"
has "$out" "no Codify project"

# ---- the absent case is machine-readable, not just a message
out="$(cd "$TMP" && HOME="$TMP" "$CG" root --json 2>/dev/null || true)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['root'] is None, d
"

# ---- a deep tree still resolves to the nearest project, not the outermost
mkdir -p "$TMP/outer/inner/proj/a/b/c/d"
out="$(cd "$TMP/outer/inner/proj/a/b/c/d" && "$CG" root)"
has "$out" "$TMP/outer/inner/proj"

# ---- every new command refuses cleanly outside a project
mkdir -p "$TMP/bare"
for c in show why test-impact brief review guard check git-sync root; do
    if ( cd "$TMP/bare" && HOME="$TMP/bare" "$CG" "$c" x >/dev/null 2>&1 ); then
        fail "cg $c should refuse outside a project"
    fi
done

echo "09_root boundaries ok"
