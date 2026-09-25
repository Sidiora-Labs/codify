#!/usr/bin/env bash
# A stand-in for curl, pointed at by CG_JEV_CURL in 28_jev.sh.
#
# cg runs `curl -K <config>`; the config names the url, the Authorization
# header, and the body file. This script reads the same config, records
# what would have been sent, and answers from JEV_FAKE_MODE:
#   ok        (default) one answer per question, typed like Jev's
#   429-once  rate-limit the first call, then ok
#   529-once  overloaded on the first call, then ok
#   500       a server error every time
#   down      no connection: curl exit 7, no status line
#   garbage   a 200 that is not JSON
#   noanswers a 200 JSON object without answers
# Records land in JEV_FAKE_DIR: request.N.json (the body cg wrote) and
# call.N.txt (argv, url, bearer token, mode).
# JEV_FAKE_CHOICE=<key> makes every choice answer pick that option when the
# question offers it; unset (or an option that is not offered) keeps the
# default, the first option as the canonical body sorted them.
set -u
if [ "${1:-}" = "--version" ]; then
    echo "curl 8.5.0-fake (x86_64-pc-linux-gnu) libcurl/8.5.0"
    exit 0
fi
dir="${JEV_FAKE_DIR:?JEV_FAKE_DIR must be set}"
mode="${JEV_FAKE_MODE:-ok}"
mkdir -p "$dir"
n=$(( $(ls "$dir" 2>/dev/null | grep -c '^request\.') + 1 ))

cfg=""
while [ $# -gt 0 ]; do
    case "$1" in
        -K|--config) cfg="$2"; shift ;;
    esac
    shift
done
[ -n "$cfg" ] && [ -f "$cfg" ] || { echo "fake-curl: no -K config file" >&2; exit 2; }

url=$(sed -n 's/^url = "\(.*\)"$/\1/p' "$cfg")
auth=$(sed -n 's/^header = "Authorization: Bearer \(.*\)"$/\1/p' "$cfg")
body=$(sed -n 's/^data-binary = "@\(.*\)"$/\1/p' "$cfg")
[ -f "$body" ] || { echo "fake-curl: body file $body missing" >&2; exit 2; }
cp "$body" "$dir/request.$n.json"
{
    echo "argv=$*"
    echo "url=$url"
    echo "auth=$auth"
    echo "mode=$mode"
    echo "cfg_mode=$(stat -c %a "$cfg")"
    echo "body_mode=$(stat -c %a "$body")"
} > "$dir/call.$n.txt"

case "$mode" in
    429-once) if [ "$n" -eq 1 ]; then printf '{"error":{"message":"rate limited"}}\n429'; exit 0; fi ;;
    529-once) if [ "$n" -eq 1 ]; then printf '{"error":{"message":"overloaded"}}\n529'; exit 0; fi ;;
    500)      printf '{"error":{"message":"boom"}}\n500'; exit 0 ;;
    down)     printf 'curl: (7) Failed to connect to openrouter.ai port 443\n000'; exit 7 ;;
    garbage)  printf '<html>not json</html>\n200'; exit 0 ;;
    noanswers) printf '{"id":"gen-x","model":"m"}\n200'; exit 0 ;;
esac

python3 - "$dir/request.$n.json" "$n" <<'EOF'
import json, os, sys
req = json.load(open(sys.argv[1]))
n = int(sys.argv[2])
forced = os.environ.get("JEV_FAKE_CHOICE", "")
answers = {}
for name, q in req["questions"].items():
    t = q["type"]
    if t == "noul":
        answers[name] = {"type": "noul", "noul": 0.95}
    elif t == "choice":
        keys = list(q["criteria"])
        pick = forced if forced in keys else keys[0]
        probs = {k: (0.88 if k == pick else round(0.12 / (len(keys) - 1), 4))
                 for k in keys}
        answers[name] = {"type": "choice", "choice": pick,
                         "probabilities": probs, "confidence": 0.82}
    else:
        levels = q["criteria"]
        legend = {str(i): l for i, l in enumerate(levels)}
        probs = {str(i): (0.94 if i == 1 else round(0.06 / (len(levels) - 1), 4))
                 for i in range(len(levels))}
        answers[name] = {"type": "score", "score": 1.06, "legend": legend,
                         "probabilities": probs, "confidence": 0.91}
doc = {"model": req["model"] + "-20260917", "answers": answers,
       "usage": {"input_tokens": 427, "output_tokens": 73, "cost": 0.000017934},
       "id": "gen-dec-fake-%d" % n, "provider": "TypeSafe"}
sys.stdout.write(json.dumps(doc, separators=(",", ":")) + "\n200")
EOF
