# Contributing to Hyperfide

Thanks for taking the time to contribute. This document explains how the project is organized, what we expect from patches, and how to get changes merged quickly.

Hyperfide is the 2.0 name of the project released as Codify through 1.x; this tree is the 2.0.0-dev development line, not a release. `hyperfide` is the canonical command. If `cg` is in your muscle memory, it still works: `cg` is a deprecated compatibility alias built from the same executable, with identical arguments, JSON and exit codes, kept for the compatibility window of the approved release (`./hyperfide help` prints the exact wording under "command names"). Every example below uses `hyperfide`.

## Ground rules

- Be respectful. The [code of conduct](CODE_OF_CONDUCT.md) applies to every interaction in this project.
- Keep changes focused. One pull request should do one thing. If you find yourself fixing an unrelated bug on the way, split it out.
- Every change that touches behavior needs a test. If it can't be tested, explain why in the PR description.
- Discuss large changes first. Open an issue before writing a thousand lines nobody asked for. Small fixes and obvious improvements can go straight to a PR.

## Getting set up

The local CLI needs a C compiler (GCC or Clang), `make`, Python 3 (the Makefile runs `scripts/hyperfide-native-components.py` to discover native component sources), and the development packages for SQLite, libcurl and OpenSSL's libcrypto — on Debian and Ubuntu, `libsqlite3-dev`, `libcurl4-openssl-dev` and `libssl-dev`.

```sh
git clone https://github.com/Sidiora-Labs/codify.git
cd codify
make            # builds ./hyperfide and ./cg, a byte-identical copy
make test       # make unit + make integration
```

If `make test` passes on a clean checkout, your environment is fine for the local CLI. In this revision two integration scripts fail regardless of environment, so check which scripts fail rather than relying on the exit status alone. `62_ast_managed.sh` links `build/libcg.a` without `-lcurl -lcrypto`. `78_v16_release.sh`, the 1.6 release gate, reruns every fixture (including 62) and requires the binary version to be 1.6.0. Note that `78_v16_release.sh` also runs `make clean` in the checkout and rebuilds with `-Werror`. That removes `build/hyperfide-native`, so rerun `make hyperfide-native` afterwards.

The Hyperfide control plane under `services/hyperfide/` is TypeScript. Its `package.json` pins Node 24.22.0 and npm 11.19.1, and `package-lock.json` pins the dependencies:

```sh
make hyperfide-deps      # npm --prefix services/hyperfide ci --ignore-scripts
make hyperfide-check     # tsc --noEmit type check
make hyperfide-services  # tsc build into services/hyperfide/dist/
make hyperfide-native    # build/hyperfide-native, the native component runner
```

`make hyperfide-native` revalidates every native component fragment on each run and removes the old `build/hyperfide-native` if validation or the build fails. Running the services is covered by the [operations guide](docs/hyperfide/operations.md); a PostgreSQL instance is needed only for the qualification cases and services that use it.

## Project layout

The C modules live mainly in `src/`. `src/cg.h` is the shared core header, with focused headers for syntax, semantic storage, search and inspection. Native grammar sources are vendored and compiled into the single `hyperfide` executable. Before adding a module, check its ownership in [the architecture guide](docs/ARCHITECTURE.md).

```
src/                 core, syntax adapters, semantic passes and focused headers
src/hyperfide/       Hyperfide native components (branding, supervisor, launch, transport, ...)
services/hyperfide/  TypeScript control, provisioner and dispatch services; PostgreSQL migrations
vendor/              vendored parser runtime and generated grammars
spec/                kvx workflow and feature specs (spec/workflow.kvx, spec/hyperfide/)
tests/unit/          C unit tests linked with the production objects
tests/integration/   shell-based end-to-end tests in temporary repositories
tests/semantic/      labelled adapter, relation and convergence fixtures
tests/scale/         reproducible resource fixtures and measured output
tests/hyperfide/     qualification harness: runner, independent checker, case registry, manifests
artifacts/hyperfide/ per-task evidence indexes (tasks/<id>/evidence-index.json)
deploy/hyperfide/    service unit files and install/migrate scripts
scripts/             native component discovery, release construction, install helpers
```

## Coding standards

- **C11 with the project's GNU/POSIX environment.** The Makefile builds with `-std=gnu11`, `-Wall`, `-Wextra` and `-pthread`. Keep compiler warnings actionable; do not assume the current implementation is strict ISO C without extensions. The workflow's lint gate builds with `-Werror`.
- **Declared dependencies only.** The C core links SQLite, libcurl and libcrypto (plus pthread and libm); the services depend on what `services/hyperfide/package.json` pins. The workflow's hard rule applies: additional dependencies are approved for Hyperfide under the versioned programme policy, and each must be declared, pinned and verified. If your change needs a new library, open an issue first.
- **Match the surrounding style.** Look at the module you are editing and follow it. Consistency inside a file beats personal preference.
- **Memory discipline.** Every allocation has an owner and a clear free path. Run your changes under `valgrind` or ASan before submitting.
- **Error handling.** Library functions return status codes; process termination belongs to the CLI entry points in `main.c`. Do not add new `exit()` calls elsewhere. Some existing paths still exit directly (fatal configuration and database-busy handling in `config.c`, `db.c` and `spec.c`), and forked children end with `_exit()`.

## Tests

- Unit tests live in `tests/unit/` and cover pure logic: the kvx grammar, configuration parsing, agent-driver argv and stream parsing, language definitions and references, SHA-256 vectors, the JSON scanner, StrBuf and IO helpers. Add one whenever you touch these areas. `make unit` builds and runs them.
- Integration tests live in `tests/integration/` as numbered shell scripts that run the real binary in temporary repositories. `make integration` runs them all through `tests/run.sh` with `CG` pointing at the checkout's `./hyperfide`. These directories isolate test data; they are not an operating-system security sandbox. If your change alters CLI output or behavior, add or update a script there.
- Spec rendering is locked to golden outputs generated by the original Go specgen. If your change legitimately alters the rendered output, regenerate the goldens and explain the difference in the PR. Byte-identical parity is a feature, so this bar is high.
- Hyperfide task qualification runs through `tests/hyperfide/qualify.py` against an immutable manifest under `tests/hyperfide/manifests/`; `tests/hyperfide/check-evidence.py` independently re-checks the recorded campaign and never executes a probe. A task's `verify_cmd` in `spec/hyperfide/spec.kvx` names the exact cases and manifest.

Run everything before pushing:

```sh
make test
"$PWD/hyperfide" spec render          # CLAUDE.md and AGENTS.md are generated and gitignored
"$PWD/hyperfide" spec render --check
"$PWD/hyperfide" spec lint
"$PWD/hyperfide" check
```

Use the checkout binary, not a potentially older `hyperfide` or `cg` on PATH. The test variable is still named `CG`: to run one script, use for example `CG="$PWD/hyperfide" tests/integration/24_docs.sh` for the documentation feature. The fleet has its own: `26_fleet.sh` (lifecycle and roles), `30_events.sh`, `31_serve.sh`, `32_supervisor.sh`, `33_drift.sh`, `34_context.sh`, and `35_fleet_e2e.sh`, which runs two features through a scripted fake driver and a fake `gh` under failure — once straight and once with the supervisor killed and resumed. None of them needs a real agent CLI or the network; `tests/lib.sh` unsets `OPENROUTER_API_KEY` for every script.

For Hyperfide changes, also run the harness self-test and the qualification command for the task you touched. Give each run a fresh output directory:

```sh
make hyperfide-check
python3 tests/hyperfide/selftest_harness.py
python3 tests/hyperfide/qualify.py --list-cases --format text
python3 tests/hyperfide/qualify.py --case V-056 --manifest tests/hyperfide/manifests/tasks/27.1.json --output-dir /tmp/hyperfide/campaign-27.1
python3 tests/hyperfide/check-evidence.py --campaign /tmp/hyperfide/campaign-27.1
```

The runner prints one JSON object such as `{"status": "PASS", "receipt_id": "...", "campaign_dir": "...", "scope": "task-component", "full_case_status": "INCOMPLETE", "diagnostics": []}` and exits 0 on PASS, 1 on a failed run and 2 when it is blocked. A task-component PASS never qualifies the full acceptance case, a provider or a release. A check result whose `seal_authentication` is `unanchored-consistency-only` shows internal consistency, not authenticated custody. Some cases need the PostgreSQL fixture or credentials named in their registration and are blocked without them.

`make release` runs `scripts/release.sh`, which builds a checksummed release tree and never publishes it. It needs `--output DIR`, a committed and clean checkout, `HYPERFIDE_BUILD_PLACEMENT=remote`, Linux x64, Node 24.22.0, npm 11.19.1 and Python 3.14.8. It is not a local test command. `make release` passes no `--output`, so in this revision it stops with a usage error; call `scripts/release.sh --output DIR` directly.

CI (`.github/workflows/ci.yml`) runs `make`, `make unit` and `make integration` on pushes to `main` and on pull requests. It does not run the services type check or the qualification harness, so run those yourself.

## The development workflow

Hyperfide is built with Hyperfide. `spec/workflow.kvx` is the source of truth. `CLAUDE.md` and `AGENTS.md` are pointers generated from it by `hyperfide spec render`; never hand-edit them. The active feature is `spec/hyperfide/spec.kvx`. Its task `status` lines (`pending`, `in_progress`, `implemented`, `done`) record what is claimed. `artifacts/hyperfide/tasks/<id>/evidence-index.json` records the evidence behind those claims.

The loop, as the workflow states it:

1. `hyperfide brief`: load repo state, active task, and prior decisions.
2. `hyperfide spec next`: take the lowest-wave eligible task.
3. `hyperfide spec start <id>`: claim it.
4. `hyperfide survey <area>` for the wide picture, then `hyperfide context <area>` for the code you need in one call.
5. Implement remotely in an isolated task workspace. Anchor nonderivable intent and retain durable evidence; the main host supervises.
6. `hyperfide review` checks the change against its criteria. `hyperfide guard` reports grounding, contract and hygiene findings. `hyperfide anchors --stale` lists docs your edits outdated.
7. Create an explicit-path Git commit tagged `[spec:<feature>/<id>]`. Qualify the task, commit its lifecycle projection, and push its reviewed task branch after every task. Git publication credentials stay at the supervising gateway.
8. `hyperfide spec done <id>`: qualification runs; done means proven.

The workflow runs in `parallel` mode with at most 8 tasks in progress. Its hierarchy has a main agent, wave managers on `wave/{feature}/{wave}` and task workers on `task/{feature}/{task}`, and lands behind the test gate `make test` and the lint gate `make hyperfide CFLAGS='-O2 -Werror'`. The hard rules are binding: never fake a test, never mark a task done that did not qualify, and declare, pin and verify dependencies. New governance warns by default; blocking is opt-in. `hyperfide recall` and `hyperfide brief` bring back recorded decisions; record new ones with `hyperfide remember` as they happen.

## Documentation is part of completion

When all implementation tasks have qualified, an enabled feature exposes `@docs`. Follow the [documentation workflow](docs/DOCUMENTATION.md) to update user guidance, developer guidance, and release/migration notes through the existing connector or an interactive session. Keep unrelated human material intact and finish with `hyperfide docs close`, which re-checks the evidence, snapshots the result and records the documentation baseline. The Hyperfide feature keeps its documentation stage in manual mode (`hyperfide spec status` shows it).

The [source reference](docs/SOURCE-REFERENCE.md) is a navigation index of implementation declarations, not a supported public API list. [Test and fixture observations](docs/TEST-REFERENCE.md) are intentionally separate. Consult [the architecture guide](docs/ARCHITECTURE.md) for module responsibilities and behavioral contracts, and the [operations guide](docs/hyperfide/operations.md) for the Hyperfide control plane and its evidence boundaries.

## Adding language or framework support

Language support has several explicit levels: native syntax-tree extraction,
selected embedded or declarative constructs, labelled heuristic fallback, and
file tracking only. See the [coverage matrix](docs/indexing.md#extraction-coverage)
before claiming a level. A new native adapter needs:

1. A vendored grammar wired into the parser runtime and an `ast_*.c` adapter
   that emits symbols, references, bindings and type facts with exact source
   sites and ownership where syntax proves them. Preserve parser limits and
   partial/error status rather than treating a parse as complete coverage.
2. Semantic-pass integration for any promised relationship. Keep ambiguous
   dispatch unresolved and retain written reference text and provenance.
3. Positive and negative fixtures for syntax extraction and relationships in
   `tests/semantic/`, plus an integration test of incremental edits and
   branch isolation where the adapter introduces a new dependency type.

For an embedded or declarative format, state the exact recognized constructs
and test nearby unsupported forms. A file-only format must report that limit
rather than emitting guessed symbols. Framework routes need literal-site
fixtures, handler evidence, and competing-handler negatives.

## Commit messages

Write in the imperative mood with a short summary line, a blank line, and a body when the change needs explanation:

```
watcher: debounce rename storms on Linux

inotify delivers MOVED_FROM/MOVED_TO as separate events, which caused
double syncs during large refactors. Coalesce pairs within the debounce
window before scheduling a sync.
```

Reference issues with `Fixes #123` where applicable.

## Release notes

The changelog is generated from these subject lines, so the prefix matters. Start a subject with the area it touches — `feat:`, `fix:`, `docs:`, `guard:`, `spec:`, `graph:`, `fleet:`, and the rest — because that prefix becomes the group heading; a subject with no prefix lands under `Other`. A scope such as `feat(hyperfide):` is printed in bold before the entry. `hyperfide commit` tags its snapshot with the in-progress task as `[spec:<feature>/<id>]` (`--git` also makes a Git commit with the same tag), and that tag becomes the task reference printed beside the commit link, so leave it on the subject line.

`hyperfide changelog` treats a tag, or a commit that changes the quoted version in `#define CG_VERSION "x"` in `src/cg.h` (or a `VERSION` file or `package.json`), as a release. Everything after a release belongs to the next version. In this revision `src/cg.h` defines `CG_VERSION` through `HYPERFIDE_VERSION` ("2.0.0-dev"). The detector does not follow that indirection, so the 2.0.0-dev work appears under `[Unreleased]`. Regenerate the file with:

```sh
./hyperfide changelog -o CHANGELOG.md
```

With `CENTRA_API_KEY` (or `HYPERFIDE_CHANGELOG_KEY`) in your environment or in `.env` (which is gitignored), each release also gets a model-written `### Highlights` paragraph. Summaries are cached under `.codegraph/changelog-cache/`, so only new releases cost a call; `--no-summarize` keeps the model out. Without a key the file is the plain derived record. Review the highlights like any other prose: the model is told not to invent anything, but it is not checked.

`cliff.toml` at the repository root is the matching git-cliff configuration. git-cliff knows only tags, so it agrees with `hyperfide changelog` for a tags-only repository with no version file and no key; test `29_changelog.sh` checks the shared rules (groups, scopes, breaking marks, task references, links). If you change the groups or the bullet shape, change `cliff.toml` and the renderer together.

## Pull request process

1. Fork, branch from `main`, and make your change.
2. Run `make test` and confirm everything passes; for Hyperfide changes, also run `make hyperfide-check` and the qualification commands for the tasks you touched.
3. Open a PR with a clear description: what changed, why, and how you verified it.
4. A maintainer will review. Expect requests for changes; that is normal and not a rejection.
5. Once approved, a maintainer merges. We use squash merges, so your PR title becomes the commit summary. Make it a good one.

CI runs `make`, `make unit` and `make integration` on every pull request. A red CI means the PR will not be reviewed until it is green.

## Reporting bugs

Open an issue with:

- The output of `hyperfide version` and `hyperfide info` (the machine profile, index coverage and parser inventory).
- Exact steps to reproduce, ideally against `tests/fixtures/` or a minimal public repo.
- What you expected and what actually happened.

For anything security-sensitive, do not open a public issue. Follow the [security policy](SECURITY.md) instead.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) that covers the project.
