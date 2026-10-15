#!/usr/bin/env sh
# Offline provenance and completeness check for the embedded parser sources.
set -eu
cd "$(dirname "$0")/.."

runtime=vendor/tree-sitter
revision=a467ea8502d95562171f97953a6dc5b2a8622609
test -f "$runtime/REVISION"
test "$(cat "$runtime/REVISION")" = "$revision"
test -s "$runtime/LICENSE"
test -s "$runtime/lib/src/unicode/LICENSE"
test -s "$runtime/lib/src/lib.c"
test -s "$runtime/lib/include/tree_sitter/api.h"
test -s "$runtime/lib/include/tree_sitter/parser.h"

if [ -d vendor/parsers ]; then
    # Grammar families may share one licence and provenance manifest across
    # several generated sources. Walk to the family root without leaving it.
    find vendor/parsers -type f -name parser.c -print | sort | while IFS= read -r parser; do
        family=$(printf '%s\n' "$parser" | cut -d/ -f1-3)
        dir=$(dirname "$parser")
        licence=0 provenance=0
        while :; do
            for name in LICENSE LICENCE LICENSE.md; do
                test ! -s "$dir/$name" || licence=1
            done
            for name in REVISION PROVENANCE MANIFEST.kvx MANIFEST.md \
                        manifest.tsv GRAMMARS.kvx; do
                test ! -s "$dir/$name" || provenance=1
            done
            test "$dir" != "$family" || break
            dir=$(dirname "$dir")
        done
        test "$licence" -eq 1 || {
            echo "missing grammar licence: $parser" >&2
            exit 1
        }
        test "$provenance" -eq 1 || {
            echo "missing grammar revision: $parser" >&2
            exit 1
        }
    done
fi
echo "vendored parser provenance: ok"
