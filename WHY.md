# Why Hyperfide exists


**Hyperfide, released as Codify through 1.x, is the infrastructure that made our approach to building software possible.**


*At Sidiora Labs, we used AI agents to build our current flagship agent and a highly complex project approaching seven million lines of code. Codify was central to making that work. It gave our agents the
context, continuity, coordination, and verification they needed to build systems at a scale we could not have managed through isolated coding sessions alone.*

*It started as an internal tool. We were building ambitious agentic systems, and we needed a better way for AI agents to work inside them. Every time our team encountered a development bottleneck, we engineered
a solution and integrated it directly into Codify. We put that solution to work, learned from it, and kept building.*

*That is how Codify grew: alongside the projects it helped create, shaped by the demands of real development.*

*The first step was a code-indexing graph. We wanted an AI agent to understand a repository structurally: where a capability lived, which symbols implemented it, what called them, and what depended on them.
Reading files individually could answer some of those questions, but repeatedly reconstructing that understanding consumed time and context that could have gone toward implementation.*

*The graph gave our agents a foundation they could build on. A question like “Catch me up on the auth code” could return entry points, symbols, callers, and routes together. Agents could get oriented quickly and
make changes with a clearer understanding of the surrounding system.*

*As the work expanded, so did Codify.*

*Long-running development needed reliable checkpoints and a useful record of change. We added snapshots, bringing history alongside the graph so agents could preserve progress and reason about the impact of
their edits.*

*Larger projects needed plans that remained connected to implementation. We added structured specifications, dependency-aware tasks, and execution waves. Work could be broken down, sequenced, and coordinated
through the same tool that understood the code.*

*Sessions needed continuity. We added persistent memory, handoffs, and restart briefs so an agent could carry useful knowledge forward instead of rebuilding its understanding whenever a session ended.*

*Completion needed evidence. We built verification into the workflow so finished work could be checked against the code, recorded changes, and required qualification steps. Our “No False Success” principle
became an engineering mechanism: progress had to be backed by something the system could inspect.*

*And as more agents worked in parallel, coordination itself became infrastructure. Codify grew to support orchestration, durable supervision, recovery, branch-aware context, and visibility into changes that
could conflict before they reached a merge.*

*None of these capabilities began as features added to fill out a product page. Each addressed a constraint we encountered while building. Each became part of the foundation for the next stage of work.*

*Over time, the simple indexing graph became an agent-centric development system we relied on every day. It connected understanding the code with planning the work, executing it, preserving state, and verifying the
result. That connection is what allowed our AI agents to contribute across sustained development efforts and increasingly complex systems.*

*The practical loop remains straightforward: identify the next task, gather the right context, implement, checkpoint, verify, and trace the result. Through MCP, AI agents can use Hyperfide throughout that loop. As
projects grow, the infrastructure carries more of the coordination and continuity that would otherwise fall back on the team.*

*For us, that translated into building our flagship agent and a project approaching seven million lines of code. Codify evolved with that workload because it was part of how the workload became possible in the
first place.*

*We kept the core practical: C, a single binary, and SQLite. The graph, memory, snapshots, and core task workflow run locally without API keys, with optional remote features available separately. The goal was
infrastructure we could depend on every day and other developers could put to work without assembling an entire platform around it.*

*The next constraint was scale itself. Hyperfide 2.0, now in development, keeps that local core and its `cg` command as a compatibility alias of `hyperfide`, and adds an
optional distributed control plane: TypeScript services with PostgreSQL as the authority for fleet ownership, and engineering work executed in isolated remote sandboxes. It is not
released, and its fleet scale is a planning target, not a measured result.*

*We open sourced Codify, now Hyperfide, because the problems it solved were bigger than our own projects. Anyone building seriously with AI agents eventually needs a dependable way to preserve context, coordinate work, and
establish what has actually been completed.*

**Hyperfide is our answer, developed through the systems we built with it. It began with an internal necessity and became one of the foundations of our engineering work. Every stage of its evolution has helped us
build further.**
# How Codify evolved into Hyperfide

**Its earliest graph-first development happened internally. The public history begins after several foundational capabilities had already come together. These milestones trace its continued growth, including the
v1.1–v1.5 development cycle:**
- August 13, 2026 · v0.1 — The foundation becomes public: code graphs, snapshots, structured specifications, verified completion, and an MCP-driven development loop. Commit
- August 16 · v0.2 — Persistent agent memory connects task notes and outcomes, giving work continuity across sessions. Commit
- August 22–27 · v0.3–v0.6 — Completion qualification, parallel work, orchestration, session handoffs, and intent tracking expand Codify’s role in coordinating development. Changelog
- August 31 · v0.8 — Fenced execution attempts, reconciliation, and bounded recovery strengthen the infrastructure for coordinated agent work. Changelog
- September 28 · v1.0 — Branch-aware graphs, fleet orchestration, shared indexing, and event delivery bring the growing system together. Changelog
- September 28 · v1.1 — Durable fleet supervision adds crash recovery, pause/resume, and approval gates for longer-running agent workflows. Implementation
- September 29 · v1.2 development milestone — Session recap turns Claude Code and Codex transcripts into focused restart briefs, helping agents resume with the context that matters. Implementation
- October 6 · v1.3 — Graph-generated code maps, configurable project paths, and portable memory make project knowledge easier to discover and carry between environments. Release
- October 7 · v1.4 development milestone — Indexing progress, configurable workers, and queued lifecycle writes improve visibility and operation under heavier workloads. Implementation
- October 13 · v1.5 — Indexed search, parallel indexing, cross-branch conflict projections, and coordinated waves of managers and task workers extend Codify’s ability to support development at scale. Release
- October 15 · v1.6 — Embedded native syntax-tree adapters across language families, with labelled extraction coverage, deepen what the graph records about code. Release
- 2.0.0-dev, in development — Codify becomes Hyperfide: `hyperfide` is the canonical command, `cg` a deprecated compatibility alias, and a distributed control plane with PostgreSQL authority and remote sandbox execution is being built and qualified task by task. Not a release.