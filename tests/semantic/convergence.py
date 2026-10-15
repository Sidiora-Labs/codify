#!/usr/bin/env python3
"""Compare real incremental indexes with indexes rebuilt from the same tree.

Sets contain source coordinates, ownership, kinds, targets and provenance;
SQLite row IDs and insertion order are intentionally excluded. A row-count
comparison cannot detect a stale edge replaced by a different wrong edge.
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile

from run import execute


SOURCE = {
    "src/lib.ts": "export function v16_target(n: number): number { return n; }\n",
    "src/caller.ts": "import { v16_target } from './lib';\nexport function v16_caller(): number { return v16_target(1); }\n",
    "src/app.ts": "import express from 'express';\nconst app = express();\nexport function v16_handler(req: any, res: any) { res.send('ok'); }\napp.get('/v16-route', v16_handler);\n",
    "tsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/*"]}}}\n',
}


def git(root: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(f"git {' '.join(args)}: {result.stderr}")
    return result.stdout.strip()


def write(root: Path, rel: str, body: str) -> None:
    file = root / rel
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(body, encoding="utf-8")


def sym_key(path: str, name: str, kind: str, qualified: str, start: int,
            end: int, line: int, column: int) -> tuple:
    return (path, name, kind, qualified, start, end, line, column)


def graph_set(db: sqlite3.Connection, branch: str | None = None) -> dict[str, set]:
    if branch:
        branch_ids = [r[0] for r in db.execute("SELECT id FROM branches WHERE name=?", (branch,))]
    else:
        branch_ids = [r[0] for r in db.execute("SELECT DISTINCT branch_id FROM files")]
    if len(branch_ids) != 1:
        raise AssertionError(f"expected one selected branch, got {branch_ids}")
    bid = branch_ids[0]
    files = {r["id"]: r["path"] for r in db.execute(
        "SELECT id,path FROM files WHERE branch_id=?", (bid,))}
    tables = {name: set() for name in ("files", "health", "symbols", "symbol_fts",
                                      "references", "bindings", "types", "edges", "routes")}
    for row in db.execute("SELECT id,path,lang,hash FROM files WHERE branch_id=?", (bid,)):
        tables["files"].add((row["path"], row["lang"], row["hash"]))
    for row in db.execute(
        """SELECT path,status,reason,parser,content_hash,last_success_hash,
                  extraction_version,pending_version
             FROM extraction_health WHERE branch_id=?""", (bid,)):
        tables["health"].add(tuple(row))
    symbols = {}
    for row in db.execute(
        """SELECT s.id,s.file_id,s.name,s.kind,ss.qualified_name,
                  ss.start_byte,ss.end_byte,ss.start_line,ss.start_column
             FROM symbols s JOIN semantic_symbols ss ON ss.symbol_id=s.id
             JOIN files f ON f.id=s.file_id WHERE f.branch_id=?""", (bid,)):
        key = sym_key(files[row["file_id"]], row["name"], row["kind"],
                      row["qualified_name"], row["start_byte"], row["end_byte"],
                      row["start_line"], row["start_column"])
        symbols[row["id"]] = key
        tables["symbols"].add(key)
    for row in db.execute(
        """SELECT s.id,t.name,t.kind,t.path,t.sig,t.words
             FROM symbols s JOIN files f ON f.id=s.file_id
             JOIN symbol_fts t ON t.rowid=s.id WHERE f.branch_id=?""", (bid,)):
        tables["symbol_fts"].add((symbols.get(row["id"]), row["name"], row["kind"],
                                   row["path"], row["sig"], row["words"]))
    for row in db.execute(
        """SELECT r.file_id,r.owner_id,r.target_id,r.original_text,r.kind,
                  r.qualifier,r.start_byte,r.end_byte,r.strategy,r.evidence
             FROM semantic_references r JOIN files f ON f.id=r.file_id
            WHERE f.branch_id=?""", (bid,)):
        tables["references"].add((files[row["file_id"]], symbols.get(row["owner_id"]),
            symbols.get(row["target_id"]), row["original_text"], row["kind"],
            row["qualifier"], row["start_byte"], row["end_byte"],
            row["strategy"], row["evidence"]))
    for row in db.execute(
        """SELECT b.file_id,b.owner_id,b.module,b.local_name,b.original_name,
                  b.kind,b.exported_name,b.is_export,b.start_byte,b.end_byte,
                  b.target_file_id,b.target_symbol_id
             FROM semantic_bindings b JOIN files f ON f.id=b.file_id
            WHERE f.branch_id=?""", (bid,)):
        tables["bindings"].add((files[row["file_id"]], symbols.get(row["owner_id"]),
            row["module"], row["local_name"], row["original_name"], row["kind"],
            row["exported_name"], row["is_export"], row["start_byte"], row["end_byte"],
            files.get(row["target_file_id"]), symbols.get(row["target_symbol_id"])))
    for row in db.execute(
        """SELECT t.file_id,t.owner_id,t.name,t.kind,t.value,t.start_byte,t.end_byte
             FROM semantic_type_facts t JOIN files f ON f.id=t.file_id
            WHERE f.branch_id=?""", (bid,)):
        tables["types"].add((files[row["file_id"]], symbols.get(row["owner_id"]),
            row["name"], row["kind"], row["value"], row["start_byte"], row["end_byte"]))
    for row in db.execute(
        """SELECT source_file_id,target_file_id,source_id,target_id,kind,
                  original_text,strategy,provenance,channel,registration_path,
                  start_byte,end_byte,registration_start_byte,registration_end_byte,
                  synthesized
             FROM semantic_edges WHERE branch_id=?""", (bid,)):
        tables["edges"].add((files[row["source_file_id"]],
            files.get(row["target_file_id"]), symbols.get(row["source_id"]),
            symbols.get(row["target_id"]), row["kind"], row["original_text"],
            row["strategy"], row["provenance"], row["channel"],
            row["registration_path"], row["start_byte"], row["end_byte"],
            row["registration_start_byte"], row["registration_end_byte"],
            row["synthesized"]))
    for row in db.execute(
        """SELECT r.file_id,r.framework,r.method,r.pattern,r.handler,r.line
             FROM routes r JOIN files f ON f.id=r.file_id WHERE f.branch_id=?""", (bid,)):
        tables["routes"].add((files[row["file_id"]], row["framework"], row["method"],
                               row["pattern"], row["handler"], row["line"]))
    return tables


def snapshot(root: Path, branch: str | None = None) -> dict[str, set]:
    db_path = root / '.codegraph/graph.db'
    if not db_path.exists() and (root / '.git').exists():
        common = git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')
        db_path = Path(common).parent / '.codegraph/graph.db'
    if not db_path.exists():
        raise AssertionError(f"index database absent for {root}: {db_path}")
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        return graph_set(db, branch)


def rebuild(cg: Path, root: Path, work: Path, label: str) -> Path:
    fresh = work / f"rebuild-{label}"
    def ignore(directory: str, names: list[str]) -> list[str]:
        return [name for name in names if name in {".git", ".codegraph"}]
    shutil.copytree(root, fresh, ignore=ignore)
    execute(cg, fresh, "init")
    return fresh


def compare(cg: Path, root: Path, work: Path, label: str,
            branch: str | None = None) -> dict:
    clean = rebuild(cg, root, work, label)
    current = snapshot(root, branch)
    expected = snapshot(clean)
    report = {}
    for table in expected:
        missing = expected[table] - current[table]
        stale = current[table] - expected[table]
        report[table] = {"synced": len(current[table]), "rebuilt": len(expected[table]),
                         "missing": sorted(map(repr, missing))[:5],
                         "stale": sorted(map(repr, stale))[:5],
                         "missing_count": len(missing), "stale_count": len(stale)}
    wrong = {table: info for table, info in report.items()
             if info["missing_count"] or info["stale_count"]}
    if wrong:
        raise AssertionError(f"{label}: normalized graph diverged: {json.dumps(wrong, indent=2)}")
    return report


def main() -> int:
    arg = argparse.ArgumentParser()
    arg.add_argument("--cg", type=Path, default=Path(os.environ.get("CG", "cg")))
    arg.add_argument("--out", type=Path)
    args = arg.parse_args()
    cg = args.cg.resolve()
    reports = {}
    with tempfile.TemporaryDirectory(prefix="codify-convergence-") as temp:
        work = Path(temp)
        root = work / "project"
        root.mkdir()
        for path, body in SOURCE.items():
            write(root, path, body)
        git(root, "init", "-q", "-b", "main")
        git(root, "config", "user.email", "semantic@test")
        git(root, "config", "user.name", "Semantic Test")
        git(root, "add", "-A")
        git(root, "commit", "-qm", "initial")
        execute(cg, root, "init")
        reports["initial"] = compare(cg, root, work, "initial", "main")

        write(root, "src/zeta.ts", "export function v16_target(n: number): number { return n * 2; }\n")
        execute(cg, root, "sync")
        reports["competing_definition"] = compare(cg, root, work, "competing", "main")

        write(root, "src/caller.ts", "import { v16_target } from './lib';\nexport function v16_caller(): number { return v16_target(2); }\n")
        execute(cg, root, "sync")
        reports["edit"] = compare(cg, root, work, "edit", "main")

        git(root, "mv", "src/zeta.ts", "src/renamed.ts")
        execute(cg, root, "sync")
        reports["rename"] = compare(cg, root, work, "rename", "main")

        (root / "src/renamed.ts").unlink()
        execute(cg, root, "sync")
        reports["delete"] = compare(cg, root, work, "delete", "main")

        write(root, "tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{"@lib/*":["src/*","src/generated/*"]}}}\n')
        execute(cg, root, "sync")
        reports["config"] = compare(cg, root, work, "config", "main")

        write(root, "src/app.ts", SOURCE["src/app.ts"].replace("/v16-route", "/v16-changed"))
        execute(cg, root, "sync")
        reports["wiring"] = compare(cg, root, work, "wiring", "main")

        git(root, "add", "-A")
        git(root, "commit", "-qm", "route-and-config")
        execute(cg, root, "sync")
        reports["commit_replay_first"] = compare(cg, root, work, "commit-first", "main")
        write(root, "src/lib.ts", "export function v16_target(n: number): number { return n + 3; }\n")
        git(root, "add", "-A")
        git(root, "commit", "-qm", "target-change")
        execute(cg, root, "sync")
        reports["commit_replay_second"] = compare(cg, root, work, "commit-second", "main")

        # The trigger injects a write failure only; all source facts still
        # come from the parser. Retry must converge without manually editing
        # a graph row or declaring the interrupted pass current.
        db_path = root / '.codegraph/graph.db'
        with sqlite3.connect(db_path) as db:
            count = db.execute("SELECT count(*) FROM semantic_edges").fetchone()[0]
            if count == 0:
                raise AssertionError("interruption fixture has no semantic edge to exercise")
            db.execute("""CREATE TRIGGER semantic_test_abort BEFORE INSERT ON semantic_edges
                          BEGIN SELECT RAISE(ABORT,'semantic test interruption'); END""")
        write(root, "src/caller.ts", "import { v16_target } from './lib';\nexport function v16_caller(): number { return v16_target(3); }\n")
        interrupted = subprocess.run([str(cg), "sync"], cwd=root, text=True,
                                     capture_output=True)
        with sqlite3.connect(db_path) as db:
            db.execute("DROP TRIGGER semantic_test_abort")
        if interrupted.returncode == 0:
            raise AssertionError("injected semantic write failure did not interrupt sync")
        execute(cg, root, "sync")
        reports["interrupted_retry"] = compare(cg, root, work, "interrupted", "main")

        # Simulate an older extractor generation over identical bytes. A
        # semantic refresh must restore name postings as well as graph rows.
        with sqlite3.connect(db_path) as db:
            row = db.execute(
                """SELECT extraction_version FROM extraction_health
                   WHERE path='src/lib.ts' AND branch_id=
                     (SELECT id FROM branches WHERE name='main')"""
            ).fetchone()
            if row is None or row[0] is None:
                raise AssertionError("missing extraction version before upgrade probe")
            db.execute(
                """UPDATE extraction_health SET extraction_version=?
                   WHERE path='src/lib.ts' AND branch_id=
                     (SELECT id FROM branches WHERE name='main')""", (row[0] - 1,)
            )
        execute(cg, root, "sync")
        reports["semantic_version_refresh"] = compare(cg, root, work,
                                                       "version-refresh", "main")
        search = execute(cg, root, "search", "v16_target")
        if "v16_target" not in search.stdout or "src/lib.ts" not in search.stdout:
            raise AssertionError("same-hash semantic refresh lost name search")

        # A linked Git worktree shares the database but has independent branch
        # facts. Compare its selected branch with a clean index of its own tree.
        side = work / "side"
        git(root, "worktree", "add", "-q", "-b", "side", str(side))
        execute(cg, side, "init")
        write(side, "src/side.ts", "export function v16_side() { return 4; }\n")
        execute(cg, side, "sync")
        reports["branch_side"] = compare(cg, side, work, "side", "side")
        reports["branch_main"] = compare(cg, root, work, "main-after-side", "main")
    output = json.dumps(reports, indent=2, sort_keys=True)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output + "\n", encoding="utf-8")
    print(output)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, sqlite3.Error) as exc:
        print(f"graph convergence: {exc}", file=sys.stderr)
        sys.exit(1)
