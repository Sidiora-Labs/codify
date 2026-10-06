# Changelog

All notable changes to this project are recorded here, generated from git history.
A release is a tag or a version bump; a group is the commit-subject prefix; a task
reference is the `[spec:<feature>/<task>]` a snapshot or fleet worker tagged the commit with.

## [v1.3.0] - 2026-10-06

### Highlights

Codify v1.3.0 ships a full codemap generator (`cg codemap`) that writes a byte-stable CODEMAP.md from the graph, a `codify.kvx` project config with `cg config list/init/get/set/check`, memory import/export over JSONL, and a spec workflow that now covers explore through carry. The index resolves prototypes to definitions, ranks by phrase over names/docs/bodies, and fills context to its token budget; the recap agent resumes from Claude Code and Codex transcripts via a cached, parallel-decided log.

- `cg codemap` writes CODEMAP.md (overview, build/test commands, layout, entry points, module symbols, directory deps, tests, workflow pointers) with `--force`/`--check`, byte-stable and budget-fitted
- `codify.kvx` config relocates spec/context/skills/codemap through a per-root cache; `[sync] auto=false` gates implicit sync; `cg config list/init/get/set/check`
- Memory export/import: JSONL by content id, graph-to-graph, MCP tools
- Spec graph check, editor hover/go-to-definition, definitions before prototypes, phrase ranking, path outlines, context filled to budget with `tokens_used`
- Recap resumes from Claude Code/Codex transcripts; Solar Decide judges statements in parallel cached chunks; `jev_ask_at` and `chat_model_ask` exposed

### Documentation
- Codify-v13 closed — architecture covers configuration, the code map and memory transport; reference tables, changelog and tool counts regenerated ([c455a26](https://github.com/Sidiora-Labs/codify/commit/c455a263dda6214893ccb0b767f15bf89ff0c2d9), task codify-v13/@docs)

### Spec workflow
- 2.1 done ([6a80082](https://github.com/Sidiora-Labs/codify/commit/6a8008296e02461da674ee2d584b0c0e9a35a760), task codify-v13/2.1)
- 3.1 done ([be19a89](https://github.com/Sidiora-Labs/codify/commit/be19a8986208b704d63c1cd6d78b74831b8cc1b1), task codify-v13/3.1)
- 4.1 done — touches and criteria aligned with the delivered change ([b9fba53](https://github.com/Sidiora-Labs/codify/commit/b9fba5356870a6469fb831fce1753b7e200e9025), task codify-v13/4.1)
- Merge codify-v13 onto main ([fd0b987](https://github.com/Sidiora-Labs/codify/commit/fd0b987e485c99b811dcb1ecaba4211def497113))
- Codify-v13 — explore, map, carry, configure ([1e0d021](https://github.com/Sidiora-Labs/codify/commit/1e0d0213ed1fc9e7dca2f9379c79a20f5613dc65))
- 1.1 done ([c24d737](https://github.com/Sidiora-Labs/codify/commit/c24d737276834d3947728070189bb4771c57df1a), task codify-v12/1.1)

### Memory
- Export and import — JSONL by content id, graph-to-graph, MCP tools ([47cac03](https://github.com/Sidiora-Labs/codify/commit/47cac035c6258bf6db068eb4cd1ee6afc73e25ae), task codify-v13/3.1)

### Codemap
- The default path, spec pointers, agent context and skills follow codify.kvx; a configured directory is created on write; codemap joins the MCP tool-list test; README counts 60 tools ([136280f](https://github.com/Sidiora-Labs/codify/commit/136280fd4b2ca20aec087ee12bd088baa2259dec), task codify-v13/2.1)
- Cg codemap writes CODEMAP.md from the graph — overview with build and test commands, layout, entry points, modules with their most-referenced symbols, directory dependencies, tests, workflow pointers; byte-stable, budget-fitted with per-section omission counts, marker-owned with --force and --check; MCP codemap tool; brief names the map and whether it is stale ([7b2bed0](https://github.com/Sidiora-Labs/codify/commit/7b2bed09a920b328f903bb6236dc9fbd0389b4f7), task codify-v13/2.1)

### Config
- Unit and integration tests, docs/config.md and README section ([b3f37f7](https://github.com/Sidiora-Labs/codify/commit/b3f37f74be5783a011829088307e8437db2b016d), task codify-v13/4.1)
- Codify.kvx project configuration — [paths] spec/context/skills/codemap relocate every spec, context and skill site through one per-root cache; [sync] auto=false gates every implicit sync; cg config list/init/get/set/check ([6b72a5a](https://github.com/Sidiora-Labs/codify/commit/6b72a5af1282bfcdeb5ed717b305a0af0fbe6185), task codify-v13/4.1)

### Index
- The spec graph check, editor hover and go-to-definition, and the agent context lead with the definition; spec: 1.1 done ([7415bfe](https://github.com/Sidiora-Labs/codify/commit/7415bfeed12e9a7e61803ecf85d9a45088761c0d), task codify-v13/1.1)
- Prototypes are declarations that end at their own ';', calls through a prototype resolve to its definition, symbol_fts carries name words, refs.target_id indexed; schema v17 ([94b0348](https://github.com/Sidiora-Labs/codify/commit/94b03485c7d75beeb6e99644ae40b6054bd4833d), task codify-v13/1.1)

### Recap
- Resume brief from Claude Code and Codex transcripts — Solar Decide (System One via the Centra gateway) judges every statement's kind, still-true and needed-to-resume in small parallel cached chunks, the picked statements form a decided log, the changelog's gateway model writes the brief; jev_ask_at and chat_model_ask exposed ([80127c3](https://github.com/Sidiora-Labs/codify/commit/80127c310196ecdeddbc013c38f0c0dbd05ddc2d), task codify-v12/1.1)

### Retrieval
- Outlines label prototypes; the code map counts definitions, not their prototypes ([29a4f34](https://github.com/Sidiora-Labs/codify/commit/29a4f3423c2755c6b68a7c866bdb59ec480f1384), task codify-v13/1.1)
- Definitions answer before prototypes, phrase ranking over names, docs and bodies, path outlines for files and directories, context filled to its budget with tokens_used ([4a32a6d](https://github.com/Sidiora-Labs/codify/commit/4a32a6dba303ec96155ee8674bd4262181abf0e0), task codify-v13/1.1)

### Other
- Update README.md ([c20c06b](https://github.com/Sidiora-Labs/codify/commit/c20c06b9ad09117652eb2a6f89f323a522f9f31d))

## [1.1.0] - 2026-09-28

### Highlights

This release adds .env to .gitignore to prevent sensitive files from being tracked. The changelog generation message has been updated for clarity, and documentation on changelog and contribution processes has been enhanced.

### Changelog
- Add .env to .gitignore; update changelog generation message for clarity; enhance documentation on changelog and contribution processes ([a0f120e](https://github.com/Sidiora-Labs/codify/commit/a0f120eca214ab53afd52d1b457475e92415b8f0))

## [1.0.0] - 2026-09-28

### Highlights

Codify 1.0.0 ships a branch-scoped code graph (schema v15/v16, freshness gates, refuse-downgrade protection), a two-level concurrent fleet with a durable supervisor (pause/resume/crash recovery, branch lifecycle, per-role capabilities), and a full agent chat surface with inline permissions, cost ledger, and cancel/retry. The spec workflow is complete end-to-end with Jev advisory triage, guard ranking, PR readiness, skills classification via MCP, and drift detection at done/merge-up. Sync gains a single-writer index gate with coalescing, and serve exposes JSON-RPC over stdio with tool list/call and event subscriptions.

- `cg spec run --fleet` — two-level fleet run with feature managers and wave workers in worktrees, resume prompts hand work upward
- `cg fleet` — begin/merge-up/land/pr/checkpoint branch lifecycle; supervisor with pause/resume, stall/retry/escalation budgets
- Branch-scoped graph — reads default to open branch, per-branch freshness, schema v16 with branch registry, refuse downgrade
- Agent chat — real diffs, terminal output, inline non-hanging permissions, cancel/retry, session switch, cost ledger
- `cg serve` — JSON-RPC over stdio, `cg tool list|call`, pushed-event subscriptions; Vscode chat with slash commands, fleet attach, approval/escalation cards

### Documentation
- Merge branch-scoped required surface and the v10 reference tables ([c845585](https://github.com/Sidiora-Labs/codify/commit/c8455850668cddbf1a2ac806de8f71922277b695))
- V10 source and test references from the required surface ([23e084f](https://github.com/Sidiora-Labs/codify/commit/23e084f080d31a827fbc4a2dba46ba2db0d9d82b))
- Derive the required surface from the open branch only ([51623a9](https://github.com/Sidiora-Labs/codify/commit/51623a9c1b546eda732bdc32d41cf9edc5d9fe6e))
- Merge cg changelog test, README and contributor notes ([c567b0d](https://github.com/Sidiora-Labs/codify/commit/c567b0dd58af3e4b429d12b769054df5bf445e48))
- Cg changelog from git — test, README, contributor notes ([a6add23](https://github.com/Sidiora-Labs/codify/commit/a6add234255f282f066c9d29df3db1c182916908))
- Re-anchor the fleet view's docs on the tree-first join ([0d86d5c](https://github.com/Sidiora-Labs/codify/commit/0d86d5c8de1ab7feb479c0227b046b6329ca803b), task codify-v10/5.3)
- V10 ships — orchestrator, skills, Jev advisories, branch-scoped reads, extension 1.3.0 ([eb11fe3](https://github.com/Sidiora-Labs/codify/commit/eb11fe325832dd8411e0cf81a265ca8a01ae72c6), task codify-v10/6.1)
- Changelog in task order, git-tagged commits as touched-path evidence ([63a116b](https://github.com/Sidiora-Labs/codify/commit/63a116b79a3f6372f932771cb671946442aeea7d), task codify-v10/6.1)
- Merge v10 documentation ([de78f2a](https://github.com/Sidiora-Labs/codify/commit/de78f2a1ebba93f2e491a0209ad68c5d7b66117d), task codify-v10/6.1)
- Correct the branch-scoping limitation — writes are scoped, reads are not ([f7c309f](https://github.com/Sidiora-Labs/codify/commit/f7c309f252588d6ba26b588e9ac7064fe1adc30a), task codify-v10/6.1)
- V10 — sync gate, fleet hierarchy, unified branch graph, Jev, extension surfaces ([3861b23](https://github.com/Sidiora-Labs/codify/commit/3861b23a6aab64994cd2bdd970d04ccae9597542), task codify-v10/6.1)
- Enable auto closure, add workflow guide, source/test references, align contributor instructions ([efd71fd](https://github.com/Sidiora-Labs/codify/commit/efd71fd6e2c1fbc28983443c18343f4990a1a52d))

### Tests
- Make 28_jev.sh executable so verify_cmd can run it ([993b673](https://github.com/Sidiora-Labs/codify/commit/993b673623d8a2a3b8f8a3f9ee8279503f3d8dbf), task codify-v10/4.1)

### Extension
- Start the fleet from the spec or the view with a plan preview, Stop/Pause/Resume, live agent steps and cost, stall/retry/escalation badges, approvals as rows, transcripts on click ([f66abcd](https://github.com/Sidiora-Labs/codify/commit/f66abcde1d41213e1244139b6c2d3055e5629740), task codify-v11/6.1)
- One cg serve connection for every call and event, rows patched from pushed events, polls off while connected, fallback for an older cg ([45591b3](https://github.com/Sidiora-Labs/codify/commit/45591b3e287a72e6ddeda72b69f7c70fd1872833), task codify-v11/5.2)
- Fleet view reads cg fleet tree ([cbda36a](https://github.com/Sidiora-Labs/codify/commit/cbda36a5c53ad9abc1b45097440980df77080602), task codify-v10/5.3)
- Fleet view reads cg fleet tree — cg's own hierarchy wins, the composed join fills the gaps and still carries an older binary ([5f521c6](https://github.com/Sidiora-Labs/codify/commit/5f521c602715d6d66e862b5c20af40594ad0b35e), task codify-v10/5.3)
- Merge memory browser follow-up against real cg shapes ([df79e9f](https://github.com/Sidiora-Labs/codify/commit/df79e9fc4c3f4207e17fd4875d9ed661d5074090), task codify-v10/5.2)
- Memory browser actions match the real cg shapes — skills keyed by memory id, promote --json, classify notices, Jev key hint ([a06f411](https://github.com/Sidiora-Labs/codify/commit/a06f411819447fb50feef0c417436212766fe8fb), task codify-v10/5.2)
- Merge agent chat polish ([0c2a3d8](https://github.com/Sidiora-Labs/codify/commit/0c2a3d89704c77b0c3c06b67d4790179b423d914), task codify-v10/5.3)
- Merge fleet view ([9936162](https://github.com/Sidiora-Labs/codify/commit/9936162ee958745409ae00ac4f9af7c2292308b0), task codify-v10/5.3)
- Agent chat — real diffs, terminal output, inline permissions that cannot hang, cancel/retry, session switch, cost ledger ([89b3b37](https://github.com/Sidiora-Labs/codify/commit/89b3b37d0360b7b9951bb617d398f314c7a00f97), task codify-v10/5.3)
- Merge task tree, filters, detail webview, actions ([65a4389](https://github.com/Sidiora-Labs/codify/commit/65a4389f7ddc2debe4240185437c04f96aa6b329), task codify-v10/5.1)
- Fleet view — Main Gideon, feature managers, wave workers, branch/heartbeat/merge state, and begin/merge-up/land/pr/checkpoint actions ([8203cd0](https://github.com/Sidiora-Labs/codify/commit/8203cd091d7adcd6199e13ab1285d63ebd04c9f5), task codify-v10/5.3)
- Task tree grouped by feature/section/wave with owner, branch and blockers, status/wave/owner filters and search in the view title, a CSP-strict task detail panel, and start/done/claim/release/branch/verify/prompt actions ([a78ee54](https://github.com/Sidiora-Labs/codify/commit/a78ee54dd4cb2aad78386b73e3b7703b8536c453), task codify-v10/5.1)
- Memory browser — CSP-strict panel with full-text search, type/class/task/branch/date filters, linked symbols and files, and supersede/forget/classify/promote actions ([a71d042](https://github.com/Sidiora-Labs/codify/commit/a71d0428f432c6d3d26b0ef306faa5dfb632ad17), task codify-v10/5.2)
- One refresh scheduler, no graph.db watcher, slow polls, trace --no-sync, codify-workflow identity ([735ded3](https://github.com/Sidiora-Labs/codify/commit/735ded33e83fc9db81b6d315d749e31b7b0c6657), task codify-v10/1.4)

### Spec workflow
- 7.1 done ([dfc7f08](https://github.com/Sidiora-Labs/codify/commit/dfc7f0879ed1c45e8d26aa47833e775e4e767d38), task codify-v11/7.1)
- 6.2 done ([2c28296](https://github.com/Sidiora-Labs/codify/commit/2c28296008292e2c2efb0654ce9ed487ef6e1ff4), task codify-v11/6.2)
- 6.1 done ([893edae](https://github.com/Sidiora-Labs/codify/commit/893edaeee63f14733e8ea646f1c7292509f30864), task codify-v11/6.1)
- 5.2 done ([10b21c3](https://github.com/Sidiora-Labs/codify/commit/10b21c39ce3152a6399c559ffd6343a41a5917b6), task codify-v11/5.2)
- 5.1 done ([c6c68c9](https://github.com/Sidiora-Labs/codify/commit/c6c68c9bb40ee72b9e7b9c9f7a261bbdd758eef2), task codify-v11/5.1)
- 4.1 done ([bc98274](https://github.com/Sidiora-Labs/codify/commit/bc982743e007e8ee8954a90f4bfa43be97f32397), task codify-v11/4.1)
- 4.3 done ([344c6e7](https://github.com/Sidiora-Labs/codify/commit/344c6e7ec81d3092cbeae67e862caffa7aa04d41), task codify-v11/4.3)
- 4.2 done ([1fde14d](https://github.com/Sidiora-Labs/codify/commit/1fde14d051f76ddf8b71394bde7ee06e30ebfa5d), task codify-v11/4.2)
- 3.2 done ([3088807](https://github.com/Sidiora-Labs/codify/commit/3088807a5361692b42ee5dda1c4e59149492a418), task codify-v11/3.2)
- 3.1 done ([d63d2ed](https://github.com/Sidiora-Labs/codify/commit/d63d2ed8990f4d9652f4021ae2c5c64b96b0569e), task codify-v11/3.1)
- 2.2 done ([08d80cc](https://github.com/Sidiora-Labs/codify/commit/08d80ccfd8b8158c797707a9e174ae2b3698eb96), task codify-v11/2.2)
- 2.1 done ([62b4bf2](https://github.com/Sidiora-Labs/codify/commit/62b4bf27fb8276ad44b0e115c8cb77605c76fc22), task codify-v11/2.1)
- 1.2 done ([62d083d](https://github.com/Sidiora-Labs/codify/commit/62d083dcbc53652ab63f6aa00d63129f64e9db6a), task codify-v11/1.2)
- 1.1 done ([7961415](https://github.com/Sidiora-Labs/codify/commit/796141579d12361074c79838a6b3370834f7c5bd), task codify-v11/1.1)
- Drop the unused clock read in spec_claim_cmd, lint-clean under -Wall -Wextra ([cf13a39](https://github.com/Sidiora-Labs/codify/commit/cf13a3937a487a27685d0fac8a07bc6c97e37986), task codify-v10/6.1)
- 5.3 done ([d290c7d](https://github.com/Sidiora-Labs/codify/commit/d290c7d44ed9f7376f19db40dc8940a2fa1b2ff1), task codify-v10/5.3)
- Git commits tagged with a task count as touched-path evidence, git log ingested before the check ([b4ea395](https://github.com/Sidiora-Labs/codify/commit/b4ea39525eb6e0e335e1d91a5dcc7bcd1ffcb388), task codify-v10/6.1)
- 2.3 done ([7482b7b](https://github.com/Sidiora-Labs/codify/commit/7482b7bdbe7c1ef4fdb879b03fc6ae697da8a1cf), task codify-v10/2.3)
- 5.1 in progress ([961269a](https://github.com/Sidiora-Labs/codify/commit/961269ab86e4c32e65e5cb96d11d6eafc7475c04), task codify-v10/5.1)

### Guard
- Fewer false unknowns — shorthand methods, expression receivers, parameters and locals, definer prefixes, attribute lists, nested manifests, Go keywords ([5e63500](https://github.com/Sidiora-Labs/codify/commit/5e6350015420d3bce62212265243d4d30411e6e5), task codify-v10/6.1)
- Ground C calls through the headers a repo include reaches, and Node core modules ([8496337](https://github.com/Sidiora-Labs/codify/commit/849633700e3f2ec9ca6ef79452a2bed09e9e2634), task codify-v10/6.1)

### Anchors
- Re-attach the doc comments v10 moved ([1c1f1f8](https://github.com/Sidiora-Labs/codify/commit/1c1f1f88631c471ad53d83006aec15a1b43d24f5), task codify-v10/6.1)

### Graph
- Merge branch-scoped indexing, queries, memory promotion, brief, watch --fleet ([d7e4e71](https://github.com/Sidiora-Labs/codify/commit/d7e4e7184bcbd676fd20e5e59b26060fec28705e), task codify-v10/3.2)
- Schema v15 with a branch registry and branch-scoped file rows, linked worktrees join the shared .codegraph, per-branch freshness and gates, cg branches, refuse to downgrade a newer database ([2253701](https://github.com/Sidiora-Labs/codify/commit/2253701856179f82cb2c98d3125b750efc657a3a), task codify-v10/3.1)

### Sync
- One post-edit hook, targeted LSP and watcher passes, freshness windows for review, agentmd, and MCP ([5702699](https://github.com/Sidiora-Labs/codify/commit/57026996a170b1c8ee36040a9cd3792782628cb2), task codify-v10/1.3)
- Single-writer index gate with coalescing, freshness, machine slots, and incremental post-scan resolution  [spec:codify-v10/1.2] ([8f6e754](https://github.com/Sidiora-Labs/codify/commit/8f6e754994c052afae812020c807a395403feee8), task codify-v10/1.1)

### Fleet
- Three-level concurrent tree — per-task branches, a merge lock instead of turn-taking, the main agent (opt-in), several features under one supervisor ([5f49b41](https://github.com/Sidiora-Labs/codify/commit/5f49b4172517b54cd816d0ba100ca6724eca4d24), task codify-v11/4.1)
- Fleet_run_open and fleet_run_resume as planned ([6c8bc03](https://github.com/Sidiora-Labs/codify/commit/6c8bc03afb4822de15a9cf04cfd2500c46d48be3), task codify-v11/3.1)
- Durable supervisor — fleet up/down/pause/resume/runs, crash resume adopting live agents, opt-in approval gates ([e638d7f](https://github.com/Sidiora-Labs/codify/commit/e638d7f8f1232357d2278c94f99c0f930c549b04), task codify-v11/3.1)
- Per-role capabilities — driver, model, args, max, wall, spend, retries, stall, approve ([ade87e1](https://github.com/Sidiora-Labs/codify/commit/ade87e1dc533b0affac8b7304f8b37153de35e1d), task codify-v11/1.2)
- Branch lifecycle — cg fleet begin/merge-up/land/pr/checkpoint, schema v16 (attempts branch/worktree/parent, memories branch/class/confidence), spec_claim shared with the fleet, git_run/worktree helpers, fake gh fixture ([83d3e2e](https://github.com/Sidiora-Labs/codify/commit/83d3e2ed4608390063326778654bc0bf084c43da), task codify-v10/2.2)
- Hierarchy config, agent roles and parents, fleet roles/status/plan ([cea966a](https://github.com/Sidiora-Labs/codify/commit/cea966a563dec24f58c82db1ef3d962bb8e3dcfe), task codify-v10/2.1)

### Orchestrate
- Merge two-level fleet run and cg fleet tree ([c4f588a](https://github.com/Sidiora-Labs/codify/commit/c4f588a6ab84854dca298df32f98f8c6e777a2e1), task codify-v10/2.3)
- Two-level fleet run — cg spec run --fleet spawns a feature manager and wave workers in their own worktrees, cg fleet tree, resume prompts that hand work upward ([b94cd35](https://github.com/Sidiora-Labs/codify/commit/b94cd35598a7d4d764ac9856a5548826b1173c03), task codify-v10/2.3)

### Jev
- Merge advisory triage, guard ranking, PR readiness ([32bc7d9](https://github.com/Sidiora-Labs/codify/commit/32bc7d96c9ddfd1d076753c6f33c9ef88020a898), task codify-v10/4.3)
- Advisory triage, guard ranking, and PR readiness — one shared key gate, verify_cmd tail through popen, one ranking call per guard run, fake-curl answer overrides ([43c9009](https://github.com/Sidiora-Labs/codify/commit/43c90095267145364c708edef027947804368488), task codify-v10/4.3)
- Client over curl with a private config file, canonical request bodies, 429/529 backoff, jev.log, cg jev doctor/ask/log, local-first principle ([2231dd5](https://github.com/Sidiora-Labs/codify/commit/2231dd533bccf5aa8dea4180a685ed4d894e6d29), task codify-v10/4.1)

### Skills
- Merge Jev memory classification, cg skills, MCP tools ([9feec06](https://github.com/Sidiora-Labs/codify/commit/9feec060a9cd16f31807a800c50855bdb894ed24), task codify-v10/4.2)
- Cg memory classify asks Jev which kind of note a memory is, cg skills list/promote/render turns the skills into owned .agents/skills/<slug>/SKILL.md, class exposed in recall/brief and the three tools over MCP ([2c4e326](https://github.com/Sidiora-Labs/codify/commit/2c4e3261c250b2dbc5c1594585b98bda8206093f), task codify-v10/4.2)

### Changelog
- Update version to 1.0.0 and modify changelog generation message; update spec status to in_progress ([7c2dda5](https://github.com/Sidiora-Labs/codify/commit/7c2dda57dedf982aa9be5d5c7112b838b5c76597))
- Git-cliff reference configuration — releases per tag, groups per subject prefix, task references ([b58fac9](https://github.com/Sidiora-Labs/codify/commit/b58fac9f95353a799fe4ac39d2bd73c8f7612560))

### Drift
- Interface drift across live branches after a merge (event + steering), requirement coverage before land with an opt-in gate, drift in brief and fleet tree ([1aeed75](https://github.com/Sidiora-Labs/codify/commit/1aeed75f11811624ff1a012d39e73f257c417b3e), task codify-v11/5.1)
- Spec drift at done and merge-up (opt-in approval), collision prediction and serialization in the supervisor, cg drift ([5aac1ae](https://github.com/Sidiora-Labs/codify/commit/5aac1aede9092e63047f95188ebb2904f0dc9341), task codify-v11/4.3)

### Drivers
- Structured Claude/Codex output read into agent.* events, role capabilities at spawn, steering by hook and prompt ([b20e14f](https://github.com/Sidiora-Labs/codify/commit/b20e14f5c12a3c9bed9cbfe283bbda45ea7fe102), task codify-v11/2.2)

### Events
- Append-only event log — triggers on durable tables, kvx status hook, fleet and orchestrator emits, cg events [--follow] ([e268cf0](https://github.com/Sidiora-Labs/codify/commit/e268cf078a2a8ebe7f7e1844492d87a56203b884), task codify-v11/1.1)

### Lang
- Index C typedef'd anonymous aggregates; stop the one-line typedef pattern naming a member ([bfc554c](https://github.com/Sidiora-Labs/codify/commit/bfc554ccfe7e80416824712bd80c0c721abbd335), task codify-v11/1.2)

### Packets
- Graph-grounded worker and manager briefings within a budget, upstream deltas in work update, cg fleet brief ([6c0e2af](https://github.com/Sidiora-Labs/codify/commit/6c0e2af8ea2729cca9285a1f10acc11e2ee238e9), task codify-v11/3.2)

### Serve
- Name the dispatcher and pusher as planned ([078a87d](https://github.com/Sidiora-Labs/codify/commit/078a87db1759d73eb5d81a38c5ddf54feee53869), task codify-v11/2.1)
- Cg serve — JSON-RPC over stdio with every tool, exec, cancel, and pushed event subscriptions; cg tool list|call ([7075df0](https://github.com/Sidiora-Labs/codify/commit/7075df01aae4e5fffd02f101402cdc9c0962b804), task codify-v11/2.1)

### Supervisor
- Budget, stall, retry, and escalate as named checks ([e050756](https://github.com/Sidiora-Labs/codify/commit/e050756ccd1840df2dd5ea0e2545e67f3842b434), task codify-v11/4.2)
- Stall nudges and restarts with handoffs, wall and spend budgets, retries carrying what failed, escalation to manager then main, blocked runs ([9a034d4](https://github.com/Sidiora-Labs/codify/commit/9a034d45ebf41c12586f4b97fb94355325adcfe0), task codify-v11/4.2)

### Work
- Upstream appears in deltas only when something merged — keep unchanged deltas compact ([719c239](https://github.com/Sidiora-Labs/codify/commit/719c2399c6d2c00eef562dfd86ea6000c07bbac5), task codify-v11/3.2)

### Other
- Fleet e2e: two features under failure, straight and killed-and-resumed; tags name their feature for packets and memories; a running task is never re-slotted; --all names the first run ([3eda32e](https://github.com/Sidiora-Labs/codify/commit/3eda32e84510f25dd5eafd019985b2f7e4ea5e27), task codify-v11/7.1)
- Vscode chat: every served tool as a slash command with typed arguments, attach to a fleet agent and steer it, approvals and escalations as cards, windowed transcript ([2fd81af](https://github.com/Sidiora-Labs/codify/commit/2fd81af6f7e94b3c9e5c758d95f4852acaa4c187), task codify-v11/6.2)
- Branch-scoped graph: reads default to the open branch, indexing reuses parsed content by hash, memories carry a branch, watch --fleet follows every worktree ([0a68e39](https://github.com/Sidiora-Labs/codify/commit/0a68e39bee5468a60accabb97c01854bca4fd5cf), task codify-v10/3.2)
- Merge main (schema v16) into 5.1 branch ([f325ef8](https://github.com/Sidiora-Labs/codify/commit/f325ef8b3f2aeea2f9c7694df31e1a57d9dece72))

## [0.9.0] - 2026-09-05

### Highlights

Fixed agent panel replay notes, cleaned session titles, and single-row timeline. Replayed sessions no longer carry Claude Code harness text in the user role. The agent panel composer is taller.

### Bug fixes
- Agent panel replay notes, cleaned session titles, single-row timeline ([4f6a02b](https://github.com/Sidiora-Labs/codify/commit/4f6a02b8ce5396162e729581a76fa620c3484a65))

### Style
- Taller agent panel composer ([17ad627](https://github.com/Sidiora-Labs/codify/commit/17ad627f6dc0de0295cefa1564b6b95f620b0775))

### Releases
- Qualify Codify 0.9.0 evidence-grounded documentation closure ([bc9ee64](https://github.com/Sidiora-Labs/codify/commit/bc9ee6450895ffe92eec37aae77d8408b82f96e0))
- Qualify Codify 1.2.5 extension ([58f5641](https://github.com/Sidiora-Labs/codify/commit/58f56418c3b124a1845c40831c310b756e29ce9a))
- Qualify Codify 0.8.5 control plane ([f825283](https://github.com/Sidiora-Labs/codify/commit/f8252837103943698f54df4b616801b8a0aa9ecc))

## [0.8.5] - 2026-09-04

### Highlights

Codify 0.8.5 updates the Agent panel with a provider picker, Codify toolbar, sub-agent view, and timeline view, and redirects the legacy Codex ACP adapter to the maintained 1.7.0 release. The graph database stays writable while the LSP indexes, and spec workflow task 5.2 now qualifies the agent panel.

- Agent panel: provider picker, Codify toolbar, sub-agent and timeline views (Extension 1.1.0)
- Default `codify.acp.codexCommand` now `npx -y @agentclientprotocol/codex-acp@1.7.0`
- Graph database writable during LSP indexing
- Spec workflow task 5.2 qualifies agent panel

### Features
- Agent panel with provider picker, Codify toolbar, sub-agent and timeline views ([0c05bf6](https://github.com/Sidiora-Labs/codify/commit/0c05bf6e1f15da6fb0a6c77cd9384e7186dcebdd))
- Redirect legacy Codex ACP adapter to maintained 1.7.0 release ([b280b70](https://github.com/Sidiora-Labs/codify/commit/b280b70c7e9d9a74577be8beaadf9c190710915a))

### Bug fixes
- Keep the graph database writable while the LSP indexes ([5771e87](https://github.com/Sidiora-Labs/codify/commit/5771e87d04c93ac5fdae76ce2655cb9b9e5d71aa))

### Spec workflow
- Qualify task 5.2 agent panel ([21b2378](https://github.com/Sidiora-Labs/codify/commit/21b23788e55319014cf941f53c898b912b65fd31))

## [0.8.0] - 2026-08-31

### Highlights

Codify 0.8.0 qualifies the control plane and modernizes MCP and generated agent ownership. It adds bounded agent recovery and work packets, normalizes agent lifecycle events, and adds a universal agent integration registry. The release also adds truthful state and fenced orchestration, fenced task attempts and reconciliation, and makes the VS Code agent chat responsive and transparent.

- Modernize MCP and generated agent ownership
- Add bounded agent recovery and work packets
- Normalize agent lifecycle events
- Add universal agent integration registry
- Add truthful state and fenced orchestration

### Features
- Modernize MCP and generated agent ownership ([8459574](https://github.com/Sidiora-Labs/codify/commit/84595747d19b8e8709a4b8ced59a6366fe50afe0))
- Add bounded agent recovery and work packets ([81511af](https://github.com/Sidiora-Labs/codify/commit/81511af870a084ffeb30c9c072026429b33e3478))
- Normalize agent lifecycle events ([482ba54](https://github.com/Sidiora-Labs/codify/commit/482ba54e2f48516d452e1fe143a5d72d90719077))
- Add universal agent integration registry ([c0b10df](https://github.com/Sidiora-Labs/codify/commit/c0b10dff3c7b0c6e458de5d1b9659a1f3a9c475c))
- Add truthful state and fenced orchestration ([fa61fe7](https://github.com/Sidiora-Labs/codify/commit/fa61fe7bac502dd11f89298c76639788a18e338f))
- Add fenced task attempts and reconciliation ([6d21c9e](https://github.com/Sidiora-Labs/codify/commit/6d21c9e15c0b6fe4dd4e70f4b6cae48a46ea1c7d))

### Releases
- Qualify Codify 0.8.0 control plane ([ee8665c](https://github.com/Sidiora-Labs/codify/commit/ee8665c3a86b5505fa6f346e57f9be83f9a35254))

### Other
- Make the VS Code agent chat responsive and transparent ([35ea32f](https://github.com/Sidiora-Labs/codify/commit/35ea32f20a9e8536a6aa4c20a4e1fa59428a68a4))

## [0.7.0] - 2026-08-29

### Highlights

Codify 0.7.0 introduces index-time call and import resolution with grounding, contract, and hygiene findings, resolving every reference to at most one target via tiered resolution (same file → explicit import → same directory → unique repo-wide definition). The kvx format subproject is added as vendored plain files with its own git history, and the VS Code extension receives refined kvx syntax highlighting, a PNG sidebar icon, and an overhauled kvx grammar with status-aware tokens.

- Index-time call and import resolution with grounding, contract, and hygiene findings
- Tiered resolution: same file → explicit import → same directory → unique repo-wide definition
- kvx format subproject vendored as plain files with standalone git history
- VS Code extension bumped to 0.8.0 and 0.7.0; refined kvx syntax highlighting
- Sidebar icon switched from SVG to PNG; kvx grammar overhauled with status-aware tokens

### Releases
- Codify 0.7.0: the resolution layer ([cd097e1](https://github.com/Sidiora-Labs/codify/commit/cd097e123141361c6d694cbf7503e4dc0e737113))

### Other
- Bump VS Code extension to 0.8.0; refine kvx syntax highlighting ([38bf3be](https://github.com/Sidiora-Labs/codify/commit/38bf3bedc66fc66f57c7c10a1f91d2716952bc3c))
- Add kvx format subproject; bump VS Code extension to 0.7.0 ([a3b05c2](https://github.com/Sidiora-Labs/codify/commit/a3b05c24fd73ef64e67d9e9e255c0ba8d7245c3e))

## [0.6.0] - 2026-08-27

### Highlights

Codify 0.6.0 indexes comments and other code the parser misses, and replaces the agent panel with a persistent sidebar view that supports concurrent sessions, a command palette, a driver picker, and a New Chat button. The VS Code extension now ships an ACP v1 client that runs Claude Code or Codex in a native webview with streamed replies, collapsed thinking, and tool-call cards showing diffs.

- Persistent "Agent" sidebar with command palette and concurrent sessions
- Lazy adapter spawn, driver picker, New Chat button
- Markdown rendering with copyable code blocks
- VS Code ACP client for Claude Code / Codex
- Streamed replies, collapsed thinking, tool-call diff cards

### Releases
- Codify 0.6.0: the intent layer ([c415829](https://github.com/Sidiora-Labs/codify/commit/c415829c0ab0f420cec7b03ff0509788b3f733c7))

### Other
- Promote agent panel to persistent sidebar chat view with command palette and concurrent task sessions ([af69fb0](https://github.com/Sidiora-Labs/codify/commit/af69fb061bf235cc20d6af96568ee482d075d808))
- Add ACP agent panel to VS Code extension ([9a1d644](https://github.com/Sidiora-Labs/codify/commit/9a1d644af90ca79e6fb6392e26f362574da43498))

## [0.4.0] - 2026-08-27

### Highlights

Codify 0.4.0 introduces agent-native orchestration via `cg spec run`, session handoff and resume, and VS Code agent sessions. Indexing accuracy improves through scope-aware extraction with stable rowids, fused ranked search with token budgets, and import-aware call resolution. The release also adds claim-next atomicity with confl.

- `cg spec run` for agent-native orchestration
- session handoff and resume
- VS Code agent sessions
- scope-aware extraction with stable rowids
- fused ranked search with token budgets

### Releases
- Codify 0.4.0: agent orchestration, session continuity, and indexing accuracy ([7712760](https://github.com/Sidiora-Labs/codify/commit/7712760555ffcab0ec2667000dbfc11d15ff32c7))

### Other
- Update VS Code extension docs for 0.3.0 LSP and memory features ([31e16e7](https://github.com/Sidiora-Labs/codify/commit/31e16e742ba90550b8d7770306009e6cf7f47c05))

## [0.3.0] - 2026-08-22

### Highlights

Prod mode is now exposed through the CLI and MCP with a complete lifecycle, an implemented state, and documented behavior for failing tests. Spec tasks run in parallel, and explicit snapshot tags are supported.

- Prod mode lifecycle with implemented state
- Prod mode exposed via CLI and MCP
- Documented behavior for failing tests
- Parallel spec tasks
- Explicit snapshot tags

### Other
- Update README and architecture docs for 0.3.0 release ([1c639cb](https://github.com/Sidiora-Labs/codify/commit/1c639cb6c244c69a2696e9d605c61a3dc146edfa))
- Finish Prod mode lifecycle and documentation ([d0b0c74](https://github.com/Sidiora-Labs/codify/commit/d0b0c74b9d2d06fbb1458d2cc923333791a59a84))
- Expose Prod mode through CLI and MCP ([14f76e1](https://github.com/Sidiora-Labs/codify/commit/14f76e18f9fe6a0a9f05fb9dd6109b5b8ee4a131))
- Add implemented lifecycle state for Prod mode ([9f06201](https://github.com/Sidiora-Labs/codify/commit/9f062015b8b3ef13db533b6e501c8fc7eb83441f))
- Specify Prod mode behavior with failing tests ([46746d1](https://github.com/Sidiora-Labs/codify/commit/46746d162ef82494b97875336e921ebc39e2396e))
- Plan Codify Prod mode implementation ([6eb0023](https://github.com/Sidiora-Labs/codify/commit/6eb00234ad4cdea56cb49c3a51d14920539eef31))
- Document Codify Prod mode lifecycle ([e53ba31](https://github.com/Sidiora-Labs/codify/commit/e53ba31edfabe4834ff5b59843c1b5af18aabe5e))
- Support parallel spec tasks and explicit snapshot tags ([3747b23](https://github.com/Sidiora-Labs/codify/commit/3747b236a7f80d59e2820100511b864ae7787d91))

## [0.2.0] - 2026-08-16

### Highlights

Codify 0.2.0 adds an agent memory layer with task-linked notes and auto-recorded outcomes. Directory touches are matched to changed descendants and in spec verification. Valid Rust keyword-like symbols are indexed, and qualified Rust symbols and GitHub workflows are traced. Installation and uninstallation scripts are added, the README is updated, and a version command is implemented.

- Agent memory layer with task-linked notes and auto-recorded outcomes
- Directory touches matched to changed descendants and in spec verification
- Index valid Rust keyword-like symbols
- Trace qualified Rust symbols and GitHub workflows
- Installation and uninstallation scripts, version command, README update

### Other
- Add agent memory layer with task-linked notes and auto-recorded outcomes ([3697f17](https://github.com/Sidiora-Labs/codify/commit/3697f1705b1c1d557ccad6f8012806e184f4ef3a))
- Match directory touches to changed descendants ([e651cef](https://github.com/Sidiora-Labs/codify/commit/e651cef0a00d0f84bd923efacd600738ff5c7d24))
- Match directory touches in spec verification ([f6b7dc3](https://github.com/Sidiora-Labs/codify/commit/f6b7dc375e7092fb50230d94c183d65628d18958))
- Index valid Rust keyword-like symbols ([d7a869c](https://github.com/Sidiora-Labs/codify/commit/d7a869c363fcfe3d20bd8094bb5880cb0e9f82bf))
- Trace qualified Rust symbols and GitHub workflows ([9c62b87](https://github.com/Sidiora-Labs/codify/commit/9c62b879482b5dc8e57cd82b73da446bea679269))
- Patch ([7b6b3a9](https://github.com/Sidiora-Labs/codify/commit/7b6b3a96606e2cc59869d152cd8a240293daa617))
- Add installation and uninstallation scripts, update README, and implement version command ([67d51ab](https://github.com/Sidiora-Labs/codify/commit/67d51abc8c3e8a88536bdce38c42e5b1e6a196cb))

## [0.1.0] - 2026-08-13

### Highlights

Initial release of Codify. The single-binary tool provides code graph, spec-driven task workflow, and agent fleet capabilities.

### Other
- First commit ([2b6dede](https://github.com/Sidiora-Labs/codify/commit/2b6dede7c99e5856ef5464fc5d1c422b5ab77808))

[v1.3.0]: https://github.com/Sidiora-Labs/codify/compare/1.1.0...v1.3.0
[1.1.0]: https://github.com/Sidiora-Labs/codify/compare/1.0.0...1.1.0
[1.0.0]: https://github.com/Sidiora-Labs/codify/compare/0.9.0...1.0.0
[0.9.0]: https://github.com/Sidiora-Labs/codify/compare/0.8.5...0.9.0
[0.8.5]: https://github.com/Sidiora-Labs/codify/compare/0.8.0...0.8.5
[0.8.0]: https://github.com/Sidiora-Labs/codify/compare/0.7.0...0.8.0
[0.7.0]: https://github.com/Sidiora-Labs/codify/compare/0.6.0...0.7.0
[0.6.0]: https://github.com/Sidiora-Labs/codify/compare/0.4.0...0.6.0
[0.4.0]: https://github.com/Sidiora-Labs/codify/compare/0.3.0...0.4.0
[0.3.0]: https://github.com/Sidiora-Labs/codify/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/Sidiora-Labs/codify/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/Sidiora-Labs/codify/releases/tag/0.1.0
