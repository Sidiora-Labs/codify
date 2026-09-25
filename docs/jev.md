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

## Jev inside deterministic commands

Three commands ask Jev a question and then print the answer beside their own
verdict. They share one gate, so the failure mode is identical everywhere: a
missing key, or a call that did not come back usable, is one line on stderr
and nothing else changes.

| Command | Question | What it adds |
|---|---|---|
| `cg spec done` on a red `verify_cmd` | why it failed, what to do next | a `jev triage:` line, and the same verdict |
| `cg guard` | a severity score per finding | `[jev <score> <level>]` and severity order |
| `cg fleet pr` | how ready the feature is | a `Jev readiness:` line in the PR body |

### Failure triage

When `verify_cmd` fails, the **last 40 lines and at most 4 KiB** of its
combined output — the part where a failure says what it was — go to Jev as
two `choice` questions: a category (`test_failure`, `build_error`,
`missing_dependency`, `flaky`, `environment`, `spec_mismatch`) and a next
action (`fix_code`, `fix_test`, `rerun`, `install_dependency`,
`revise_spec`, `ask_human`).

```
$ cg spec done 2.1
…
FAIL: expected 3, got 4
cg spec: verify_cmd failed (exit 1) — task 2.1 NOT marked done (--force to override)
jev triage: test_failure (confidence 0.82) → fix_test (confidence 0.82)
```

The verdict is unchanged — the task is still not done — and the triage is
appended to the outcome memory the failure records, so the next session
reads it without asking again:

```
$ cg recall --task adv/2.1 --type outcome -n 1
#3  [outcome]  2026-09-25  (task adv/2.1)  auto
    blocked: Advisory work — verify_cmd failed (exit 1) [jev: test_failure → fix_test]
```

Without a key, the failure is reported exactly as before and the triage says
it was skipped, once, not once per question:

```
cg spec: verify_cmd failed (exit 1) — task 2.1 NOT marked done (--force to override)
jev: OPENROUTER_API_KEY is not set — failure triage skipped
```

A call that fails reads the same way — `jev: failure triage skipped — jev
request failed (status 500)` — and never invents an annotation on the
memory.

### Guard ranking

`cg guard` scores every finding in **one** call, whatever the count (capped
at 50), and prints them most severe first:

```
$ cg guard src/typo.ts
guard: every change is inside task 2.1's declared scope
  warn  src/typo.ts:3: function 'doWork' has no inbound reference  [jev 3.80 Blocking]
  warn  src/typo.ts:5: helpr() is not defined and nothing external accounts for it  [jev 0.20 Noise]
guard: 2 finding(s) (advisory, most severe first)
```

`--json` carries `jev_ranked`, and `jev_score` / `jev_level` per finding —
`null` when no rank was obtained:

```json
{"findings":[{"kind":"hygiene","path":"src/typo.ts","line":3,
              "detail":"function 'doWork' has no inbound reference",
              "jev_score":3.8,"jev_level":"Blocking"}],"jev_ranked":true}
```

Without a key the summary line loses "most severe first", the findings keep
their original order, and the exit code is untouched: `cg guard --strict`
still fails on out-of-scope edits and still passes on in-scope ones, in
Jev's order or not.

### Pull request readiness

`cg fleet pr` asks one `noul` question about the state it can prove —
feature, branch, base, commits ahead, and the task list with what is
qualified — and writes the answer into the PR body:

```
Jev readiness: 0.95 (high) — 0/2 tasks qualified, 0 commits, gates not run in this command
```

A low score says so (`0.30 (low)`) and never stops the pull request. With no
key, or on a failed call, the line is simply absent and the body is what it
always was.

## Memory classification and skills

`cg memory classify` asks Jev what a memory actually is. This one is
**mandatory**, not advisory: classification is the whole command, so with no
key it fails rather than guessing.

```
$ cg memory classify --all
classified 2 memories:
  #1    decision     skill      0.82  reusable 0.95  Use the trigram index for symbol search
  #2    constraint   skill      0.82  reusable 0.95  Never store secrets in memory
skill candidates: 1,2 — promote with `cg skills promote <id>`
```

Each memory is one call, carrying two questions: a `choice` between `skill`,
`decision`, `constraint`, `fact` and `noise`, and a `noul` on whether the
note is reusable beyond its own task. The class and its confidence are
stored on the memory (`memories.class`, `memories.confidence`, schema v16),
so nothing is asked twice — `cg memory classify` with no argument does the
unclassified ones and says `no memories to classify` when there are none.
`--all` re-asks everything; `<id>` does one; `-n N` caps the batch.

The class then travels with the memory, in `cg recall`:

```
#1  [decision]  2026-09-25  class skill 0.82
    Use the trigram index for symbol search
```

and in `cg brief`, as `[decision/skill]`. Both carry `class` and
`confidence` in `--json`.

### `cg skills`

A memory classed `skill` is a candidate for promotion into an **Agent
Skill** — the portable `SKILL.md` format every agent host reads.

| Command | Does |
|---|---|
| `cg skills list` | the candidates, which are promoted, and which have drifted from their memory |
| `cg skills promote <id>` | write `.agents/skills/<slug>/SKILL.md` from that memory |
| `cg skills render` | refresh every generated file from its memory; name the orphans |

```
$ cg skills list
skills — 2 candidate(s), 0 promoted under .agents/skills:
  #1    candidate 0.82  Use the trigram index for symbol search
        cg skills promote 1

$ cg skills promote 1
promoted #1 -> .agents/skills/use-the-trigram-index-for-symbol-search/SKILL.md
```

The file is generated, and says so:

```markdown
---
name: use-the-trigram-index-for-symbol-search
description: "Use the trigram index for symbol search"
generated_by: codify
source_memory: 1
---

<!-- codify-owned: memory-skill v1 — generated by Codify from memory #1. Edit the
     memory and run `cg skills render`; edits made here are overwritten. -->

# Use the trigram index for symbol search

## Where this came from

- memory: #1 — codify://memory/1
- kind: decision, classed skill (0.82), recorded 2026-09-25
- recall: `cg recall "Use the trigram index for symbol"`
```

Two rules keep that honest. A file **without** the `codify-owned:` marker is
never overwritten — `cg skills promote` refuses with *was not generated by
Codify*, and `cg skills render` leaves it alone. And promotion lives in the
file, not the database, so re-classifying a memory never silently
un-promotes a skill somebody is using; it only makes the rendered copy
`stale`, which `cg skills list` says and `cg skills render` fixes.

Forget the memory behind a promoted file and it becomes an orphan:
`cg skills render` reports `orphaned: … memory #1 no longer exists`, and
`cg integrate doctor` names it too.

All three are exposed over MCP as `memory_classify`, `skills_list`, and
`skills_promote`, and a Jev failure there is an `isError` result rather than
noise on the protocol stream.

## Testing without the network

`CG_JEV_CURL` points at any executable that speaks curl's `-K <config>`
interface. `tests/fixtures/jev/fake-curl.sh` reads the same config,
records the body that would have been sent, and answers from
`JEV_FAKE_MODE` — `ok`, `429-once`, `529-once`, `500`, `down`, `garbage`,
`noanswers`. That is how the integration tests assert the canonical body,
the file permissions, the retry ladder, and the log format without a key
or a network.

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
- Classification is one call per memory, so `cg memory classify --all` over
  a large memory store is that many calls. `cg memory classify` on its own
  only does the unclassified ones, which is the cheap path.
- A promoted `SKILL.md` is a generated copy. Codify writes it from the
  memory and never reads edits back: change the note, then
  `cg skills render`.
- Triage reads the tail of the output, not the whole log. A failure whose
  only explanation is in the first line of a 10,000-line run is one Jev
  cannot see.
