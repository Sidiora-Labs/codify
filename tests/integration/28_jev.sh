#!/usr/bin/env bash
# jev: TypeSafe System One decisions through curl.
#   client   — (task 4.1) mandatory key, canonical request body, the key
#              never on a command line, noul/choice/score answers, retries
#              on 429/529, clear failures, jev.log, doctor, ask, log
#   skills   — (task 4.2) memory classification and skill promotion
#   advisory — (task 4.3) failure triage, finding rank, PR readiness
# Run one section: 28_jev.sh client
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

FAKE="$FIXTURES/jev/fake-curl.sh"
export CG_JEV_BACKOFF_MS=1

# capture stderr of a failing command
stderr_of() { "$@" 2>&1 >/dev/null || true; }

reset_fake() { rm -rf "$JEV_FAKE_DIR"; mkdir -p "$JEV_FAKE_DIR"; }

if want client; then
    cp -r "$FIXTURES/sample" "$TMP/proj"
    cd "$TMP/proj"
    "$CG" init >/dev/null
    export JEV_FAKE_DIR="$TMP/fake"
    export JEV_FAKE_MODE=ok
    unset OPENROUTER_API_KEY CG_JEV_CURL CG_JEV_MODEL CG_JEV_ENDPOINT || true

    # ---- the key is mandatory: no key, no call, and the reason is spelled out
    expect_rc 1 "$CG" jev ask --state hello --noul greeting "Is it a greeting?"
    err="$(stderr_of "$CG" jev ask --state hello --noul greeting "Is it a greeting?")"
    has "$err" "OPENROUTER_API_KEY is not set"
    has "$err" "mandatory"
    has "$err" "cg jev doctor"
    expect_rc 1 "$CG" jev doctor
    out="$("$CG" jev doctor || true)"
    has "$out" "key: OPENROUTER_API_KEY is not set"
    has "$out" "jev: typesafe/jev-1.13 via https://openrouter.ai/api/alpha/decisions"
    out="$("$CG" jev doctor --json || true)"
    echo "$out" | pyjson '
assert d["ok"] is False and d["key"] is False, d
assert d["model"] == "typesafe/jev-1.13", d
assert d["endpoint"] == "https://openrouter.ai/api/alpha/decisions", d
assert d["probe"] is None and d["calls"] == 0, d
' || fail "doctor JSON without key"
    [ ! -e .codegraph/jev.log ] || fail "a refused call must not be logged"

    # ---- a key but no curl
    export OPENROUTER_API_KEY=sk-or-v1-0123456789abcdef0123456789abcd
    err="$(CG_JEV_CURL=/nonexistent/curl stderr_of "$CG" jev ask --state hello --noul q "Q?")"
    has "$err" "curl not found"
    has "$err" "CG_JEV_CURL"
    out="$(CG_JEV_CURL=/nonexistent/curl "$CG" jev doctor || true)"
    has "$out" "curl: not found"
    has "$out" "key: OPENROUTER_API_KEY set (sk-or-…abcd)"

    # ---- a full ask through the fake: three question types, canonical body
    export CG_JEV_CURL="$FAKE"
    reset_fake
    out="$("$CG" jev ask --json --state '{"message":"My card was declined"}' \
        --noul is_urgent "The customer needs help immediately." \
        --choice department "Which team should handle this message?" \
            --option sales=Buying --option "billing=Payments and refunds" \
        --score frustration "Rate the frustration." \
            --level Calm --level Frustrated --level "Very angry")"
    echo "$out" | pyjson '
a = d["answers"]
assert d["model"] == "typesafe/jev-1.13-20260917", d
assert d["requested_model"] == "typesafe/jev-1.13", d
assert d["id"] == "gen-dec-fake-1", d
assert d["attempts"] == 1 and d["ms"] >= 0, d
assert d["usage"]["input_tokens"] == 427 and d["usage"]["output_tokens"] == 73, d
assert abs(d["usage"]["cost"] - 0.000017934) < 1e-9, d
assert a["is_urgent"] == {"type": "noul", "value": 0.95, "confidence": 0.95}, a
assert a["department"]["type"] == "choice" and a["department"]["value"] == "billing", a
assert a["department"]["confidence"] == 0.82, a
assert a["department"]["probabilities"] == {"billing": 0.88, "sales": 0.12}, a
assert a["frustration"]["type"] == "score" and a["frustration"]["value"] == 1.06, a
assert a["frustration"]["legend"] == {"0": "Calm", "1": "Frustrated", "2": "Very angry"}, a
assert a["frustration"]["confidence"] == 0.91, a
' || fail "ask JSON: $out"
    body="$(cat "$JEV_FAKE_DIR/request.1.json")"
    want_body='{"model":"typesafe/jev-1.13","questions":{"department":{"criteria":{"billing":"Payments and refunds","sales":"Buying"},"instructions":"Which team should handle this message?","type":"choice"},"frustration":{"criteria":["Calm","Frustrated","Very angry"],"instructions":"Rate the frustration.","type":"score"},"is_urgent":{"instructions":"The customer needs help immediately.","type":"noul"}},"state":{"message":"My card was declined"}}'
    [ "$body" = "$want_body" ] || fail "request body is not canonical:
$body"
    call="$(cat "$JEV_FAKE_DIR/call.1.txt")"
    has "$call" "url=https://openrouter.ai/api/alpha/decisions"
    has "$call" "auth=$OPENROUTER_API_KEY"
    hasnt "$(grep '^argv=' "$JEV_FAKE_DIR/call.1.txt")" "$OPENROUTER_API_KEY"
    has "$call" "cfg_mode=600"
    has "$call" "body_mode=600"
    [ -z "$(ls .codegraph | grep '^jev\.[0-9]*\.' || true)" ] || fail "request files left behind"

    # ---- text output, and a plain-word state becomes a JSON string
    out="$("$CG" jev ask --state hello --noul greeting "The state is a greeting.")"
    has "$out" "greeting  noul    0.95  (yes)"
    has "$out" "model typesafe/jev-1.13-20260917 · 427 in, 73 out · \$0.000018"
    body="$(cat "$JEV_FAKE_DIR/request.2.json")"
    has "$body" '"state":"hello"'
    out="$("$CG" jev ask --state '"x"' \
        --choice team "Which team?" --option a=A --option b=B \
        --score mood "Mood?" --level low --level mid --level high)"
    has "$out" "team      choice  a  confidence 0.82  [a 0.88, b 0.12]"
    has "$out" "mood      score   1.06 ~ mid  confidence 0.91"

    # ---- every call is logged
    [ "$(wc -l < .codegraph/jev.log)" -eq 3 ] || fail "expected 3 log lines"
    line1="$(head -1 .codegraph/jev.log)"
    has "$line1" '"status":200'
    has "$line1" '"questions":3'
    has "$line1" '"attempts":1'
    has "$line1" '"request_sha256":"'
    has "$line1" '"response_sha256":"'
    has "$line1" '"model":"typesafe/jev-1.13-20260917"'
    has "$line1" '"id":"gen-dec-fake-1"'
    has "$line1" '"input_tokens":427'
    out="$("$CG" jev log)"
    has "$out" "ok    3q  typesafe/jev-1.13-20260917  427/73 tok  \$0.000018"
    has "$out" "gen-dec-fake-1"
    "$CG" jev log --json | pyjson 'assert len(d) == 3 and d[0]["questions"] == 3, d' \
        || fail "log JSON"
    "$CG" jev log -n 1 --json | pyjson 'assert len(d) == 1 and d[0]["questions"] == 2, d' \
        || fail "log -n"
    out="$("$CG" jev doctor)"
    has "$out" "curl: $FAKE (8.5.0-fake)"
    has "$out" "log: $TMP/proj/.codegraph/jev.log — 3 calls, last "
    "$CG" jev doctor --json | pyjson "
assert d['ok'] is True and d['key'] is True and d['key_hint'] == 'sk-or-…abcd', d
assert d['curl'] == '$FAKE' and d['curl_version'] == '8.5.0-fake', d
assert d['calls'] == 3 and d['last_call'] > 0 and d['probe'] is None, d
" || fail "doctor JSON"

    # ---- CG_JEV_MODEL and CG_JEV_ENDPOINT reach the request
    reset_fake
    out="$(CG_JEV_MODEL=typesafe/jev-9 CG_JEV_ENDPOINT=https://example.test/decide \
        "$CG" jev ask --json --state 1 --noul q "Q?")"
    echo "$out" | pyjson '
assert d["requested_model"] == "typesafe/jev-9", d
assert d["model"] == "typesafe/jev-9-20260917", d
' || fail "model override"
    has "$(cat "$JEV_FAKE_DIR/request.1.json")" '"model":"typesafe/jev-9"'
    has "$(cat "$JEV_FAKE_DIR/call.1.txt")" "url=https://example.test/decide"
    has "$(tail -1 .codegraph/jev.log)" '"endpoint":"https://example.test/decide"'

    # ---- a request file, and the same on stdin
    reset_fake
    cat > "$TMP/req.json" <<'EOF'
{"state": {"a": 1},
 "questions": {"z": {"type": "noul", "instructions": "Z?"},
               "a": {"type": "score", "instructions": "A?", "criteria": ["low", "high"]}}}
EOF
    "$CG" jev ask "$TMP/req.json" --json | pyjson '
assert set(d["answers"]) == {"z", "a"}, d
assert d["answers"]["a"]["legend"] == {"0": "low", "1": "high"}, d
' || fail "request file"
    python3 - "$JEV_FAKE_DIR/request.1.json" <<'EOF' || fail "request file body"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["model"] == "typesafe/jev-1.13", d
assert d["state"] == {"a": 1}, d
assert list(d["questions"]) == ["z", "a"], d
EOF
    "$CG" jev ask - --json < "$TMP/req.json" | pyjson 'assert "z" in d["answers"], d' \
        || fail "stdin request"
    echo '{"model":"typesafe/jev-2","state":"s","questions":{"q":{"type":"noul","instructions":"Q?"}}}' \
        | "$CG" jev ask - --json | pyjson 'assert d["requested_model"] == "typesafe/jev-1.13" and d["model"] == "typesafe/jev-2-20260917", d' \
        || fail "a request file's own model is sent as-is"
    err="$(stderr_of "$CG" jev ask "$TMP/req.json" --noul q "Q?")"
    has "$err" "carries its own state and questions"
    echo '{"state":1}' > "$TMP/bad.json"
    err="$(stderr_of "$CG" jev ask "$TMP/bad.json")"
    has "$err" 'needs "state" and a "questions" object'

    # ---- 429 and 529 back off and retry; other failures are final
    reset_fake
    JEV_FAKE_MODE=429-once "$CG" jev ask --json --state 1 --noul q "Q?" \
        | pyjson 'assert d["attempts"] == 2 and d["answers"]["q"]["value"] == 0.95, d' \
        || fail "429 retry"
    [ "$(ls "$JEV_FAKE_DIR" | grep -c '^request\.')" -eq 2 ] || fail "429: expected 2 sends"
    has "$(tail -1 .codegraph/jev.log)" '"attempts":2'
    reset_fake
    JEV_FAKE_MODE=529-once "$CG" jev ask --json --state 1 --noul q "Q?" \
        | pyjson 'assert d["attempts"] == 2, d' || fail "529 retry"
    reset_fake
    expect_rc 1 env JEV_FAKE_MODE=500 "$CG" jev ask --state 1 --noul q "Q?"
    err="$(JEV_FAKE_MODE=500 stderr_of "$CG" jev ask --state 1 --noul q "Q?")"
    has "$err" "jev request failed (status 500)"
    has "$err" "boom"
    [ "$(ls "$JEV_FAKE_DIR" | grep -c '^request\.')" -eq 2 ] || fail "500 must not retry"
    last="$(tail -1 .codegraph/jev.log)"
    has "$last" '"status":500'
    has "$last" '"error":"jev request failed (status 500)'
    reset_fake
    err="$(JEV_FAKE_MODE=down stderr_of "$CG" jev ask --state 1 --noul q "Q?")"
    has "$err" "curl exited 7 after 4 attempts"
    has "$err" "Failed to connect"
    [ "$(ls "$JEV_FAKE_DIR" | grep -c '^request\.')" -eq 4 ] || fail "down: expected 4 attempts"
    reset_fake
    err="$(JEV_FAKE_MODE=down CG_JEV_ATTEMPTS=2 stderr_of "$CG" jev ask --state 1 --noul q "Q?")"
    has "$err" "after 2 attempts"
    [ "$(ls "$JEV_FAKE_DIR" | grep -c '^request\.')" -eq 2 ] || fail "CG_JEV_ATTEMPTS ignored"
    err="$(JEV_FAKE_MODE=garbage stderr_of "$CG" jev ask --state 1 --noul q "Q?")"
    has "$err" "jev response is not JSON"
    has "$err" "<html>"
    err="$(JEV_FAKE_MODE=noanswers stderr_of "$CG" jev ask --state 1 --noul q "Q?")"
    has "$err" "no answers object"
    out="$("$CG" jev log -n 5)"
    has "$out" "fail  1q  status 500 (1 attempt)  jev request failed"
    has "$out" "fail  1q  status 0 (2 attempts)  jev: curl exited 7"

    # ---- doctor --probe sends one real decision
    reset_fake
    out="$("$CG" jev doctor --probe)"
    has "$out" "probe: ok — typesafe/jev-1.13-20260917 answered noul 0.95"
    python3 - "$JEV_FAKE_DIR/request.1.json" <<'EOF' || fail "probe body"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["state"] == "ping" and list(d["questions"]) == ["probe"], d
assert d["questions"]["probe"]["type"] == "noul", d
EOF
    "$CG" jev doctor --probe --json | pyjson '
assert d["ok"] is True and d["probe"]["ok"] is True, d
assert d["probe"]["value"] == 0.95 and d["probe"]["model"] == "typesafe/jev-1.13-20260917", d
' || fail "probe JSON"
    expect_rc 1 env JEV_FAKE_MODE=500 "$CG" jev doctor --probe
    out="$(JEV_FAKE_MODE=500 "$CG" jev doctor --probe || true)"
    has "$out" "probe: failed — jev request failed (status 500)"
    out="$(JEV_FAKE_MODE=500 "$CG" jev doctor --probe --json || true)"
    echo "$out" | pyjson '
assert d["ok"] is False and d["probe"]["ok"] is False and "status 500" in d["probe"]["error"], d
' || fail "probe failure JSON"

    # ---- argument validation happens before any call
    reset_fake
    err="$(stderr_of "$CG" jev ask --state 1 --choice c "C?" --option only=one)"
    has "$err" "choice c needs at least 2 options"
    err="$(stderr_of "$CG" jev ask --state 1 --score s "S?" --level one)"
    has "$err" "score s needs at least 2 levels"
    err="$(stderr_of "$CG" jev ask --state 1 --noul n "N?" --option true=yes)"
    has "$err" "noul n needs both true= and false= or neither"
    err="$(stderr_of "$CG" jev ask --state 1 --noul n "N?" --option maybe=x)"
    has "$err" "takes only true= and false="
    err="$(stderr_of "$CG" jev ask --state 1 --option a=b)"
    has "$err" "belongs after a --choice or --noul"
    err="$(stderr_of "$CG" jev ask --state 1 --level a)"
    has "$err" "belongs after a --score"
    err="$(stderr_of "$CG" jev ask --state 1)"
    has "$err" "no questions"
    err="$(stderr_of "$CG" jev ask --noul q "Q?")"
    has "$err" "no state"
    err="$(stderr_of "$CG" jev ask --state '{bad' --noul q "Q?")"
    has "$err" "state is not JSON"
    err="$(stderr_of "$CG" jev ask --state 1 --noul q "Q?" --bogus)"
    has "$err" "unknown option --bogus"
    expect_rc 1 "$CG" jev bogus
    [ -z "$(ls "$JEV_FAKE_DIR")" ] || fail "validation errors must not call out"
    # noul criteria are sent sorted
    "$CG" jev ask --state 1 --noul n "N?" --option true=yes --option false=no >/dev/null
    has "$(cat "$JEV_FAKE_DIR/request.1.json")" '"n":{"criteria":{"false":"no","true":"yes"},"instructions":"N?","type":"noul"}'

    # ---- outside a project doctor still answers; ask works but is not logged
    cd "$TMP"
    reset_fake
    out="$("$CG" jev doctor)"
    has "$out" "log: (no Codify project here"
    out="$("$CG" jev ask --state 1 --noul q "Q?" 2>&1)"
    has "$out" "the call was not logged"
    has "$out" "q         noul    0.95  (yes)"
    expect_rc 1 "$CG" jev log

    # ---- the principle moved from local-only to local-first
    has "$(cat "$FIXTURES/../../spec/workflow.kvx")" "local_first"
    hasnt "$(cat "$FIXTURES/../../spec/workflow.kvx")" "local_only"
fi

echo "ok 28_jev ($section)"
