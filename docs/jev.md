# Jev decisions

Jev is TypeSafe AI's **System One** decision model, reached over OpenRouter
as `typesafe/jev-1.13`. It does not generate text. It answers a fixed set
of typed questions about a state, and that is the whole interface.

Codify's core loop — graph, memory, spec, snapshots — still runs with no
network. Jev is the one remote call, and the principle changed name to say
so:

> **Local first.** The graph, memory, and workflow run with no network and
> no telemetry. Jev decisions are the one remote call: mandatory for the
> features built on them, never for the core loop, and never authoritative
> — they narrow, rank, and flag; `verify_cmd` and graph checks decide.

Two halves of that rule matter equally. **Mandatory**: a Jev-backed command
with no `OPENROUTER_API_KEY` fails with a clear message rather than quietly
degrading to a worse heuristic — a silent fallback makes the feature a lie.
**Advisory**: nothing Jev returns can pass or fail anything. It classifies,
ranks, and flags; the deterministic checks stay the only authority.

Implemented in `src/jev.c`; covered by `tests/integration/28_jev.sh`.

## Question types

| Type | Answer | Use |
|---|---|---|
| `noul` | probability the statement is true, plus a confidence (distance from undecided) | yes/no judgements |
| `choice` | one of 2–255 labelled options, with per-option probabilities and a confidence | classification |
| `score` | an ordinal level with a legend, plus probabilities and a confidence | ranking, severity |

One request carries several questions about one state. The body is built
canonically — question names and criteria keys sorted, compact, state
verbatim — so the same question always hashes the same in the log:

```json
{"model":"typesafe/jev-1.13",
 "questions":{
   "category":{"criteria":{"compile":"a compile or link error",
                           "env":"a missing tool or environment problem",
                           "test":"a failing assertion"},
               "instructions":"Classify the failure","type":"choice"},
   "flaky":{"instructions":"Is this failure flaky rather than a real defect?",
            "type":"noul"},
   "severity":{"criteria":["low","medium","high"],
               "instructions":"How severe is it?","type":"score"}},
 "state":"the build failed: undefined reference to alpha"}
```

## Transport

The system's `curl`, run through `popen` with a **private config file**:

- the key is never on a command line, where `ps` could read it;
- the body goes through a file, so no shell ever sees it;
- both files are `0600`, written under the project's `.codegraph/` (or a
  per-user `/tmp/codify-<uid>` when there is no project), and removed after
  the call.

`429` (rate limited) and `529` (overloaded) back off and retry — four
attempts by default, doubling from 500 ms. A connection failure retries
too. Anything else fails at once, with the status and an excerpt of the
response body.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | — | **mandatory**; no key, no call |
| `CG_JEV_MODEL` | `typesafe/jev-1.13` | model id |
| `CG_JEV_ENDPOINT` | `https://openrouter.ai/api/alpha/decisions` | decisions endpoint |
| `CG_JEV_CURL` | `curl` | a path, or a name looked up on `PATH` |
| `CG_JEV_TIMEOUT` | `30` | seconds per attempt |
| `CG_JEV_ATTEMPTS` | `4` | attempts including the first |
| `CG_JEV_BACKOFF_MS` | `500` | first backoff; doubles per retry |

A missing key is spelled out rather than worked around:

```
$ cg jev ask --state hello --noul greeting "Is it a greeting?"
cg: OPENROUTER_API_KEY is not set. Jev is mandatory for this command —
export the key in the agent's environment (cg jev doctor checks it)
```

A refused call is not logged: nothing was sent.

## Commands

### `cg jev doctor`

Key, curl, endpoint, model, and log health in one call. Exits non-zero when
Jev could not be used.

```
$ cg jev doctor
jev: typesafe/jev-1.13 via https://openrouter.ai/api/alpha/decisions
key: OPENROUTER_API_KEY set (sk-or-…ca41)
curl: /usr/bin/curl (8.5.0)
log: /path/proj/.codegraph/jev.log — 1 call, last 2026-09-25 12:05
```

The key is only ever shown as a prefix and its last four characters.
`--probe` sends one tiny decision to prove the endpoint answers.
`--json` reports `ok`, `key`, `model`, `endpoint`, `probe`, `calls`.

### `cg jev ask`

Ask directly — the operator's way to see what Jev does with a state, and
how the tests drive it.

```
$ cg jev ask --state "the build failed: undefined reference to alpha" \
    --noul flaky "Is this failure flaky rather than a real defect?" \
    --choice category "Classify the failure" \
      --option compile="a compile or link error" \
      --option test="a failing assertion" \
      --option env="a missing tool or environment problem" \
    --score severity "How severe is it?" --level low --level medium --level high
category  choice  compile  confidence 0.82  [compile 0.88, env 0.06, test 0.06]
flaky     noul    0.95  (yes)
severity  score   1.06 ~ medium  confidence 0.91
model typesafe/jev-1.13-20260917 · 427 in, 73 out · $0.000018 · 116 ms
```

A complete request body can be passed instead, as a file or on stdin:
`cg jev ask request.json`, `cg jev ask -`. A missing `model` in the body is
filled in from the configuration.

`--json` returns the answers structurally:

```json
{"model":"typesafe/jev-1.13-20260917","requested_model":"typesafe/jev-1.13",
 "id":"gen-dec-…","usage":{"input_tokens":427,"output_tokens":73,"cost":1.7934e-05},
 "attempts":1,"ms":214,
 "answers":{"q":{"type":"noul","value":0.95,"confidence":0.95}}}
```

### `cg jev log`

Every call, successful or not, appends one JSON line to
`.codegraph/jev.log`. `cg jev log [-n N]` renders the tail:

```
2026-09-25 12:43:17  ok    3q  typesafe/jev-1.13-20260917  427/73 tok  $0.000018  116 ms  gen-dec-…1
2026-09-25 12:43:18  ok    1q  typesafe/jev-1.13-20260917  427/73 tok  $0.000018  109 ms  gen-dec-…3
2026-09-25 12:43:18  fail  1q  status 500 (1 attempt)  jev request failed (status 500): {"error":{"message":"boom"}}
```

Request id, model actually served, token counts, cost, latency, and the
attempt count are all on the line, so "what did the fleet spend on
decisions today" is a `wc` and an `awk` away.

## Testing without the network

`CG_JEV_CURL` points at any executable that speaks curl's `-K <config>`
interface. `tests/fixtures/jev/fake-curl.sh` reads the same config,
records the body that would have been sent, and answers from
`JEV_FAKE_MODE` — `ok`, `429-once`, `529-once`, `500`, `down`, `garbage`,
`noanswers`. That is how the integration tests assert the canonical body,
the file permissions, the retry ladder, and the log format without a key
or a network.

## Planned in v10 (not yet shipped)

- **Task 4.2 — memory classification and skills.** `cg memory classify`
  asking Jev to class each memory as skill, decision, constraint, fact, or
  noise with a confidence, storing it in `memories.class` /
  `memories.confidence` (the columns exist as of schema v16), and exposing
  the class through `recall` and `brief`; `cg skills list|promote|render`
  writing `.agents/skills/<slug>/SKILL.md` with the Codify ownership marker
  and a link back to the source memory; all of it exposed over MCP.
- **Task 4.3 — failure triage and guard ranking.** A failing `verify_cmd`
  in `cg spec done` triaged into a category and a next action, both
  recorded on the outcome memory; `cg guard` ranking its findings by a Jev
  severity score while pass/fail stays deterministic; `cg fleet pr` asking
  for a readiness score and including it in the PR body.

## Limitations

- Jev needs the network and a key. Everything else in Codify does not, and
  no core-loop command has been made to depend on it.
- Answers are advice. No Jev output changes an exit code: qualification is
  `verify_cmd` plus the graph checks, and `cg guard --strict` fails on its
  own deterministic findings, in Jev's order.
- The transport is `curl`. There is no built-in HTTP client, and there will
  not be one — libsqlite3 and libc remain the only link-time dependencies.
- `jev.log` grows without bound and is never read back by Codify. It is
  evidence for an operator, not state.
