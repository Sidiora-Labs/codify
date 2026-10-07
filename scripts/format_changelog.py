#!/usr/bin/env python3
"""Preview a changelog grouped by date and type without inventing metadata.

Release headers and non-entry prose, including Highlights, are retained. Structured
subjects remain literal. Ordinary metadata is recovered from a structured Git
subject or explicit Leader/Worker/Branch trailers. Otherwise the actual Git author
is the leader, the worker is contributor-inferred, and the branch is main-inferred
only for commits reachable from local main, otherwise branch-unrecorded. These
labels describe inference, not historical authorship or branch facts. Fields with
spaces are JSON-quoted. --missing-metadata compact omits ordinary metadata fields.
Dates come from a structured subject's ISO date, otherwise the linked local Git
commit's authored date (including its original timezone). Types use a conventional
commit prefix, otherwise the conservative verb table below, otherwise Other.
Add/implement/introduce/enable infer Features except immediate test/docs/tooling
nouns, which take the specific type. All type inference is classification, not
qualification. Within each date/type group input order is retained. No history is
rewritten and original subjects are never replaced by Git subjects.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path

TYPES = (
    "Features",
    "Bug fixes",
    "Refactoring",
    "Documentation",
    "Tests",
    "Build and tooling",
    "Improvement",
    "Other",
)
PREFIXES = {
    "feat": "Features",
    "fix": "Bug fixes",
    "refactor": "Refactoring",
    "docs": "Documentation",
    "test": "Tests",
    "build": "Build and tooling",
    "ci": "Build and tooling",
    "chore": "Build and tooling",
    "perf": "Improvement",
}
VERBS = {
    "fix": "Bug fixes",
    "correct": "Bug fixes",
    "repair": "Bug fixes",
    "resolve": "Bug fixes",
    "refactor": "Refactoring",
    "reorganize": "Refactoring",
    "document": "Documentation",
    "test": "Tests",
    "verify": "Tests",
    "assert": "Tests",
    "exercise": "Tests",
    "build": "Build and tooling",
    "package": "Build and tooling",
    "release": "Build and tooling",
    "add": "Features",
    "implement": "Features",
    "introduce": "Features",
    "enable": "Features",
}
ENTRY = re.compile(
    r"^- (.+?) (\(\[[0-9a-fA-F]+\]\(https://[^\s)]+/commit/([0-9a-fA-F]{7,40})\)\))$"
)
TOKEN = r'(?:"(?:\\.|[^"\\])*"|\S+)'
STRUCTURED = re.compile(
    rf"^{TOKEN}\s+{TOKEN}\s+(\d{{4}}-\d{{2}}-\d{{2}})\s+{TOKEN}\s+[0-9a-fA-F]{{40}}\s+(.+)$"
)
METADATA = re.compile(
    rf"^({TOKEN})\s+({TOKEN})\s+\d{{4}}-\d{{2}}-\d{{2}}\s+({TOKEN})\s+[0-9a-fA-F]{{40}}\s+.+$"
)
RELEASE = re.compile(r"^## \[[^\]]+\].*$", re.MULTILINE)
HEADING = re.compile(r"^#{3,} .*$", re.MULTILINE)


class FormatError(ValueError):
    pass


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=False
    )
    if result.returncode:
        raise FormatError(
            f"Git lookup failed: {' '.join(args)}: {result.stderr.strip()}"
        )
    return result.stdout


class Dates:
    RECORD_FORMAT = "%H%x00%aI%x00%an%x00%cn%x00%B%x00"

    def __init__(self, repo: Path):
        self.repo = repo
        self.records = self._records(
            git(repo, "log", "--all", "--format=" + self.RECORD_FORMAT)
        )
        main = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--verify", "refs/heads/main"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.main_ancestors = (
            set(git(repo, "rev-list", "refs/heads/main").splitlines())
            if main.returncode == 0
            else set()
        )

    @staticmethod
    def _records(payload: str) -> dict[str, tuple[str, str, str, str]]:
        fields = payload.split("\0")
        records = {}
        for index in range(0, len(fields) - 1, 5):
            if index + 4 >= len(fields):
                raise FormatError("Malformed Git metadata response")
            records[fields[index].strip()] = (
                fields[index + 1],
                fields[index + 2],
                fields[index + 3],
                fields[index + 4],
            )
        return records

    def resolve(self, commit: str) -> tuple[str, str]:
        matches = [key for key in self.records if key.startswith(commit.lower())]
        if len(matches) > 1:
            raise FormatError(f"Ambiguous linked commit: {commit}")
        if not matches:
            recovered = self._records(
                git(
                    self.repo,
                    "show",
                    "-s",
                    "--format=" + self.RECORD_FORMAT,
                    "--no-patch",
                    commit + "^{commit}",
                )
            )
            self.records.update(recovered)
            matches = list(recovered)
        full_hash = matches[0]
        try:
            return (
                full_hash,
                date.fromisoformat(self.records[full_hash][0][:10]).isoformat(),
            )
        except ValueError as exc:
            raise FormatError(
                f"Invalid authored date for linked commit {commit}"
            ) from exc

    def metadata(self, commit: str) -> tuple[str, str, str]:
        _, author, committer, body = self.records[commit]
        first_line = body.strip().splitlines()[0] if body.strip() else ""
        structured = METADATA.fullmatch(first_line)
        if structured:
            leader, worker, branch = structured.groups()
            return (
                quoted_subject(leader),
                quoted_subject(worker),
                quoted_subject(branch),
            )
        recorded = {}
        trailer_block = body.strip().rsplit("\n\n", 1)[-1]
        for line in trailer_block.splitlines():
            trailer = re.fullmatch(
                r"(?:Gideon-)?(Leader|Worker|Branch):[ \t]*(.+)", line, re.IGNORECASE
            )
            if trailer:
                key = trailer[1].lower()
                value = quoted_subject(trailer[2].strip())
                if key in recorded and recorded[key] != value:
                    raise FormatError(f"Conflicting {key} trailers for commit {commit}")
                recorded[key] = value
        return (
            recorded.get("leader", author or committer or "author-unrecorded"),
            recorded.get("worker", "contributor-inferred"),
            recorded.get(
                "branch",
                (
                    "main-inferred"
                    if commit in self.main_ancestors
                    else "branch-unrecorded"
                ),
            ),
        )


def metadata_token(value: str) -> str:
    if re.fullmatch(r'[^\s"\\]+', value):
        return value
    return json.dumps(value, ensure_ascii=False)


def quoted_subject(subject: str) -> str:
    if subject.startswith('"'):
        try:
            decoded = json.loads(subject)
        except ValueError:
            pass
        else:
            if isinstance(decoded, str):
                return decoded
    return subject


def entry_type(subject: str) -> str:
    conventional = re.match(r"^([a-z]+)(?:\([^\n)]+\))?!?:", subject, re.IGNORECASE)
    if conventional:
        return PREFIXES.get(conventional[1].lower(), "Other")
    words = subject.lower().split(maxsplit=2)
    if (
        words
        and words[0] in {"add", "implement", "introduce", "enable"}
        and len(words) > 1
    ):
        noun = words[1].rstrip(":,.")
        if noun in {"test", "tests", "assertion", "assertions", "coverage"}:
            return "Tests"
        if noun in {"docs", "documentation", "readme"}:
            return "Documentation"
        if noun in {"tooling", "ci", "build", "packaging"}:
            return "Build and tooling"
    return VERBS.get(words[0] if words else "", "Other")


@dataclass
class Entry:
    day: str
    kind: str
    text: str


def parse_entry(
    line: str, dates: Dates, missing_metadata: str, canonical: bool
) -> Entry:
    match = ENTRY.fullmatch(line)
    if not match:
        raise FormatError(f"Unsupported changelog entry: {line[:160]}")
    subject, link, commit = match.groups()
    structured = STRUCTURED.fullmatch(subject)
    if structured:
        try:
            day = date.fromisoformat(structured[1]).isoformat()
        except ValueError as exc:
            raise FormatError(f"Invalid structured date: {structured[1]}") from exc
        description = structured[2]
        # Existing literal subjects sometimes contain escaped quote delimiters.
        if description.startswith(r"\"") and description.endswith(r"\""):
            description = description[2:-2]
        else:
            description = quoted_subject(description)
        formatted = subject
    else:
        description = quoted_subject(subject) if canonical else subject
        full_hash, day = dates.resolve(commit)
        formatted = json.dumps(description, ensure_ascii=False)
        if missing_metadata == "recover":
            leader, worker, branch = (
                metadata_token(value) for value in dates.metadata(full_hash)
            )
            formatted = f"{leader} {worker} {day} {branch} {full_hash} {formatted}"
    return Entry(day, entry_type(description), f"- {formatted} {link}")


def section(body: str, dates: Dates, newline: str, missing_metadata: str) -> str:
    chunks = re.split(r"(?=^#{3,} )", body, flags=re.MULTILINE)
    tokens: list[str | Entry] = []
    canonical = False
    for chunk in chunks:
        lines = chunk.splitlines(keepends=True)
        heading = (
            lines[0].strip() if lines and HEADING.fullmatch(lines[0].strip()) else ""
        )
        if heading == "### Highlights":
            if any("/commit/" in line and line.startswith("- ") for line in lines):
                raise FormatError(
                    "Commit entries inside Highlights require explicit separation"
                )
            tokens.append(chunk)
            continue
        if re.fullmatch(r"### \d{4}-\d{2}-\d{2}", heading):
            canonical = True
        grouped = heading.lstrip("# ") in {*TYPES, "Spike"} or bool(
            re.fullmatch(r"### \d{4}-\d{2}-\d{2}", heading)
        )
        index = 1 if heading else 0
        if grouped:
            # A structural heading's padding belongs to that heading, not the
            # preceding Highlights or the release footer.
            while index < len(lines) and not lines[index].strip():
                index += 1
        elif heading:
            tokens.append(lines[0])
        while index < len(lines):
            line = lines[index]
            if line.startswith("- ") and "/commit/" in line:
                entry = parse_entry(
                    line.rstrip("\r\n"), dates, missing_metadata, canonical
                )
                continuation: list[str] = []
                index += 1
                while index < len(lines):
                    indented = lines[index].startswith(("  ", "\t"))
                    paragraph_break = (
                        not lines[index].strip()
                        and index + 1 < len(lines)
                        and lines[index + 1].startswith(("  ", "\t"))
                    )
                    if not indented and not paragraph_break:
                        break
                    continuation.append(lines[index])
                    index += 1
                entry.text += (
                    newline + "".join(continuation).rstrip("\r\n")
                    if continuation
                    else ""
                )
                tokens.append(entry)
                continue
            if line.startswith("- ") or (grouped and line.startswith("* ")):
                raise FormatError(
                    f"Entry without a supported commit link: {line.strip()[:160]}"
                )
            tokens.append(line)
            index += 1
    positions = [
        index for index, token in enumerate(tokens) if isinstance(token, Entry)
    ]
    if not positions:
        return "".join(token for token in tokens if isinstance(token, str))
    first, last = positions[0], positions[-1]
    prefix = "".join(token for token in tokens[:first] if isinstance(token, str))
    suffix = "".join(token for token in tokens[last + 1 :] if isinstance(token, str))
    interleaved = "".join(
        token for token in tokens[first : last + 1] if isinstance(token, str)
    )
    if interleaved.strip():
        raise FormatError(
            "Prose between commit entries requires explicit separation; refusing to relocate it"
        )
    groups: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for token in tokens:
        if isinstance(token, Entry):
            groups[token.day][token.kind].append(token.text)
    output = []
    for day in sorted(groups, reverse=True):
        output.append(f"### {day}")
        for kind in TYPES:
            if kind in groups[day]:
                output.append(
                    f"#### {kind}" + newline + newline + newline.join(groups[day][kind])
                )
    if prefix and not prefix.endswith(newline + newline):
        prefix += newline
    return prefix + (newline + newline).join(output) + newline + suffix


def format_changelog(text: str, repo: Path, missing_metadata: str = "recover") -> str:
    releases = list(RELEASE.finditer(text))
    if not releases:
        raise FormatError("No ## [version] release headers found")
    newline = "\r\n" if "\r\n" in text else "\n"
    dates = Dates(repo)
    output = [text[: releases[0].start()]]
    for index, release in enumerate(releases):
        end = releases[index + 1].start() if index + 1 < len(releases) else len(text)
        output.append(release.group().rstrip("\r") + newline + newline)
        output.append(
            section(
                text[release.end() : end].lstrip("\r\n"),
                dates,
                newline,
                missing_metadata,
            )
        )
    return "".join(output).rstrip("\r\n") + newline


def atomic_output(path: Path, content: bytes, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=Path("CHANGELOG.md"))
    parser.add_argument("--repo", type=Path, default=Path.cwd())
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument(
        "--check", action="store_true", help="Exit 1 if formatting differs"
    )
    modes.add_argument(
        "--write", action="store_true", help="Replace source after private backup"
    )
    modes.add_argument(
        "--output", type=Path, help="Write a preview to a different file"
    )
    parser.add_argument(
        "--backup", type=Path, help="Required with --write; outside the Git worktree"
    )
    parser.add_argument(
        "--expected-sha256", help="Refuse a source differing from the reviewed hash"
    )
    parser.add_argument(
        "--missing-metadata",
        choices=("recover", "compact"),
        default="recover",
        help="Shape of ordinary entries; existing structured subjects stay literal",
    )
    args = parser.parse_args(argv)
    try:
        original = args.path.read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        if args.expected_sha256 and args.expected_sha256 != digest:
            raise FormatError("Source differs from the reviewed SHA-256")
        result = format_changelog(
            original.decode("utf-8"), args.repo, args.missing_metadata
        ).encode("utf-8")
        if args.check:
            return int(result != original)
        if args.output:
            if args.output.resolve() == args.path.resolve():
                raise FormatError("--output cannot replace the source; use --write")
            atomic_output(args.output, result)
        elif args.write:
            worktree = Path(
                git(args.repo, "rev-parse", "--show-toplevel").strip()
            ).resolve()
            if not args.backup or args.backup.resolve().is_relative_to(worktree):
                raise FormatError("--write requires --backup outside the Git worktree")
            if args.backup.exists():
                raise FormatError("Backup already exists; refusing to overwrite it")
            args.backup.parent.mkdir(parents=True, exist_ok=True)
            backup_fd = os.open(
                args.backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600
            )
            with os.fdopen(backup_fd, "wb") as backup:
                backup.write(original)
                backup.flush()
                os.fsync(backup.fileno())
            if args.path.read_bytes() != original:
                raise FormatError(
                    "Source changed during formatting; refusing replacement"
                )
            atomic_output(args.path, result, args.path.stat().st_mode & 0o777)
        else:
            sys.stdout.write(result.decode("utf-8"))
        return 0
    except (OSError, UnicodeError, FormatError) as exc:
        print(f"format_changelog: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
