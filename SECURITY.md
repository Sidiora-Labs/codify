# Security Policy

Codify runs entirely on the local machine, parses untrusted source code, executes user-defined commands (`verify_cmd`), and writes into developer configuration files (`cg mcp-install`). Each of those is an attack surface, and we treat reports against them seriously.

## Supported versions

| Version | Supported |
|---|---|
| Latest release | Yes |
| Latest `main` | Yes, best effort |
| Older releases | No |

Security fixes land in `main` and in a patch release of the latest version. We do not backport to older releases, so keep your install current.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report privately through one of:

- GitHub private vulnerability reporting on this repository (preferred)
- Email: security@sidiora.com

Include as much of the following as you can:

- A description of the issue and its impact
- Steps to reproduce, ideally with a minimal proof of concept
- The version or commit you tested (`cg info` prints it)
- Any suggested fix, if you have one

You will get an acknowledgment within 3 business days. We aim to triage within a week and, for confirmed issues, ship a fix within 90 days. We will keep you informed as work progresses and credit you in the release notes unless you prefer otherwise.

## What counts as a vulnerability here

Reports we especially want:

- **Parser abuse.** Crafted source files that crash the indexer, cause memory corruption, or trigger out-of-bounds reads or writes in the per-language pattern engines, the kvx parser, or the JSON scanner.
- **Path traversal.** Snapshot restore (`cg checkout`) or object storage writing outside the repository, or ignore-rule bypasses that leak files into snapshots unexpectedly.
- **Config injection.** `cg mcp-install` merges into editor configuration files; anything that lets a hostile repository plant unintended entries there is in scope.
- **Command execution.** `cg spec done` runs `verify_cmd` from the spec file. That is by design when the user trusts the repo, but any way to run commands *without* that step, or to smuggle commands past what the file visibly declares, is a vulnerability.
- **MCP server issues.** Malformed protocol input crashing the stdio server or corrupting the database.
- **Hash integrity.** Anything that breaks the content-addressing guarantees of the snapshot store.

Out of scope:

- Running `cg` against a repository you already fully control executing that repo's own declared `verify_cmd`
- Denial of service by pointing the indexer at pathologically large inputs on your own machine
- Issues in third-party tools that `cg mcp-install` connects to
- Reports from automated scanners with no demonstrated impact

## Design notes relevant to security

- Codify makes no network connections. There is no telemetry, no update check, and no data leaves the machine. If you observe network traffic originating from `cg`, that alone is reportable.
- All state lives under `.codegraph/` in the repository. Deleting that directory removes everything.
- The database is plain SQLite with no server component listening on any port.

## Disclosure

We follow coordinated disclosure. Once a fix is released, we publish an advisory describing the issue, affected versions, and credit. We ask reporters to hold public details until the advisory is out or 90 days have passed, whichever comes first.
