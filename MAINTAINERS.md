# Maintainers

This file lists the people responsible for Codify, what they own, and how maintainership works. It is the authoritative record; if GitHub permissions and this file ever disagree, this file wins and permissions get corrected.

## Current maintainers

| Name | GitHub | Role | Areas |
|---|---|---|---|
| Andrew | @sidiora-labs | Lead maintainer, architect | Everything; final say on architecture, releases, and the kvx spec format |

Contact for project matters: maintainers@sidiora.com

## What maintainers do

- Review and merge pull requests
- Triage issues and label them honestly, including closing ones that will not be worked on
- Cut releases and write release notes
- Handle security reports per [SECURITY.md](SECURITY.md)
- Enforce the [code of conduct](CODE_OF_CONDUCT.md)
- Keep `docs/ARCHITECTURE.md` truthful as the code evolves

## Decision making

Day-to-day decisions are made in issues and pull requests by whoever is doing the work, subject to review. Anything that changes an external contract gets extra scrutiny before merge:

- CLI flags and output formats
- The `--json` schemas
- MCP tool names and shapes
- The kvx grammar and spec render output (locked to golden files)
- The snapshot object format

Disagreements are resolved by discussion first. If discussion stalls, the lead maintainer decides. Decisions are recorded in the relevant issue so they do not have to be re-argued from memory.

## Becoming a maintainer

There is no application form. Maintainers are invited after a track record of:

- Several merged contributions of real substance, not just typo fixes
- Review comments on other people's PRs that demonstrate understanding of the codebase
- Reliability: doing what you said you would do, on roughly the timeline you said

If that describes you, an existing maintainer will likely reach out. You can also express interest at maintainers@sidiora.com.

## Stepping down

Maintainers can step down at any time by updating this file. Life happens, and a clean handoff is worth far more than a lingering absent name. Maintainers inactive for 12 months will be moved to emeritus status after a check-in.

## Emeritus

None yet.
