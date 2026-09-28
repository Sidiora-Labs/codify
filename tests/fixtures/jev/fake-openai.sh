#!/usr/bin/env bash
# A stand-in for curl against an OpenAI-compatible chat endpoint, pointed at
# by CG_CHANGELOG_CURL. Records the request body it was given (the -K config
# names it as data-binary = "@<file>") under $OPENAI_FAKE_DIR/req-N.json and
# answers a canned completion, with the HTTP code write-out curl would add.
set -u
dir="${OPENAI_FAKE_DIR:?OPENAI_FAKE_DIR must be set}"
mkdir -p "$dir"
cfg=""
while [ $# -gt 0 ]; do case "$1" in -K) cfg="$2"; shift ;; esac; shift; done
n="$(ls "$dir"/req-*.json 2>/dev/null | wc -l)"; n=$((n+1))
body="$(sed -n 's/^data-binary = "@\(.*\)"$/\1/p' "$cfg")"
cp "$body" "$dir/req-$n.json"
cp "$cfg" "$dir/cfg-$n.txt"
if [ -f "$dir/fail" ]; then printf '{"error":{"message":"quota"}}\n429'; exit 0; fi
if [ -f "$dir/heading" ]; then
    printf '%s\n200' '{"id":"x","choices":[{"index":0,"message":{"role":"assistant","content":"## Highlights\n\nKnobs and dials arrive."}}]}'
    exit 0
fi
printf '%s\n200' '{"id":"x","choices":[{"index":0,"message":{"role":"assistant","content":"This release adds the gauge and hardens the parser against empty input.\n\n- Gauges land in the UI\n- The old flag is gone"}}]}'
