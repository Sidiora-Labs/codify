#!/usr/bin/env python3
"""Index real source snippets and score the labelled semantic facts.

This runner reads SQLite only after `cg init` produced the index. It never
inserts expected graph facts into a database. A missing semantic table or
coverage column is a failure, because a name-only fallback would hide a
missing adapter.
"""

import argparse
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

from catalog import CASES, REQUIRED_ADAPTERS
from edge_catalog import EDGES
from frameworks import FRAMEWORKS, REQUIRED_FRAMEWORKS


REQUIRED_TABLES = {"files", "symbols", "semantic_symbols", "semantic_references", "semantic_edges",
                   "routes", "extraction_health"}
ADAPTERS_ALLOWED_TO_USE_FALLBACK = {
    "pascal", "cobol", "vbnet", "cfscript", "cfquery", "arkts",
    "vue", "svelte", "astro", "liquid", "razor", "cfml", "delphi_form", "mybatis",
}
VALID_COVERAGE = {"complete", "partial", "skipped", "failed"}


def execute(cg: Path, root: Path, *args: str) -> subprocess.CompletedProcess:
    result = subprocess.run([str(cg), *args], cwd=root, text=True, capture_output=True)
    if result.returncode:
        raise AssertionError(
            f"{root}: cg {' '.join(args)} exited {result.returncode}\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
    return result


def project(work: Path, name: str, files: dict[str, str]) -> Path:
    root = work / name
    root.mkdir()
    for rel, source in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
    return root


def db_open(root: Path) -> sqlite3.Connection:
    db = sqlite3.connect(f"file:{root / '.codegraph/graph.db'}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    missing = REQUIRED_TABLES - tables
    if missing:
        db.close()
        raise AssertionError(f"{root}: semantic schema missing tables {sorted(missing)}")
    return db


def file_coverage(db: sqlite3.Connection, path: str) -> dict:
    columns = {r[1] for r in db.execute("PRAGMA table_info(extraction_health)")}
    required = {"status", "reason", "parser", "last_success_hash", "content_hash"}
    if not required <= columns:
        raise AssertionError(f"extraction_health lacks coverage contract {sorted(required - columns)}")
    row = db.execute(
        """SELECT f.lang,f.hash,h.status,h.reason,h.parser,
                  h.content_hash,h.last_success_hash
             FROM files f JOIN extraction_health h
               ON h.branch_id=f.branch_id AND h.path=f.path
            WHERE f.path=?""",
        (path,),
    ).fetchone()
    if row is None:
        raise AssertionError(f"source file not indexed: {path}")
    return dict(row)


def symbol_rows(db: sqlite3.Connection, path: str) -> list[dict]:
    return [dict(r) for r in db.execute(
        """SELECT s.name,s.kind,s.line,ss.qualified_name,ss.start_byte,
                  ss.end_byte,ss.start_line,ss.start_column,ss.parser_id
             FROM symbols s JOIN files f ON f.id=s.file_id
             JOIN semantic_symbols ss ON ss.symbol_id=s.id
            WHERE f.path=? ORDER BY ss.ordinal""",
        (path,),
    )]


def route_rows(db: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in db.execute(
        """SELECT r.framework,r.method,r.pattern,r.handler,r.line,f.path AS source_path
             FROM routes r JOIN files f ON f.id=r.file_id ORDER BY f.path,r.line"""
    )]


def edge_rows(db: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in db.execute(
        """SELECT sf.path AS source_path,ss.name AS source_name,
                  ss.kind AS source_kind,
                  ssm.qualified_name AS source_qualified,
                  tf.path AS target_path,ts.name AS target_name,
                  tsm.qualified_name AS target_qualified,
                  e.kind,e.original_text,e.strategy,e.provenance,e.evidence,
                  e.start_line,e.start_column,e.channel,e.registration_path,
                  e.registration_line,e.synthesized
             FROM semantic_edges e
             JOIN files sf ON sf.id=e.source_file_id
             LEFT JOIN symbols ss ON ss.id=e.source_id
             LEFT JOIN semantic_symbols ssm ON ssm.symbol_id=e.source_id
             LEFT JOIN files tf ON tf.id=e.target_file_id
             LEFT JOIN symbols ts ON ts.id=e.target_id
             LEFT JOIN semantic_symbols tsm ON tsm.symbol_id=e.target_id
            ORDER BY sf.path,e.start_line,e.kind,tf.path,ts.name"""
    )]


def symbol_line(source: str, name: str) -> int:
    lines = source.splitlines()
    matches = [i for i, line in enumerate(lines, 1) if name in line and "decoy" not in line]
    if not matches:
        raise AssertionError(f"label {name}: no source declaration")
    # Declarations may appear in both an interface and implementation. The
    # label names the first source site; additional sites are scored separately.
    return matches[0]


def score_language(cg: Path, work: Path, case) -> dict:
    root = project(work, f"language-{case.adapter}", {case.path: case.source})
    execute(cg, root, "init")
    with db_open(root) as db:
        coverage = file_coverage(db, case.path)
        rows = symbol_rows(db, case.path)
        unresolved = db.execute(
            """SELECT count(*) FROM semantic_references r JOIN files f ON f.id=r.file_id
                WHERE f.path=? AND r.target_id IS NULL""", (case.path,)).fetchone()[0]
    if coverage["status"] not in VALID_COVERAGE:
        raise AssertionError(f"{case.adapter}: invalid coverage {coverage['status']!r}")
    if not coverage["parser"]:
        raise AssertionError(f"{case.adapter}: parser identity missing")
    if case.support == "file-only":
        # File-level tracking must be labelled and must not invent a symbol.
        if coverage["status"] != "complete" or rows or \
           not coverage["parser"].startswith("file-only:") or \
           coverage["last_success_hash"] != coverage["hash"]:
            raise AssertionError(f"{case.adapter}: file-only input has unlabelled structural coverage")
        return {"adapter": case.adapter, "support": case.support, "coverage": coverage,
                "symbol_tp": 0, "symbol_fp": 0, "symbol_fn": 0, "rows": rows,
                "unresolved": unresolved}
    if case.support == "reference-only":
        with db_open(root) as db:
            refs = [dict(r) for r in db.execute(
                """SELECT r.original_text,r.kind,r.start_line,r.evidence
                     FROM semantic_references r JOIN files f ON f.id=r.file_id
                    WHERE f.path=?""", (case.path,))]
        expected_line = symbol_line(case.source, case.symbol)
        positive = [r for r in refs if r["original_text"] == case.symbol
                    and r["kind"] == case.kind and r["start_line"] == expected_line]
        false = [r for r in refs if r["original_text"] == case.absent]
        return {"adapter": case.adapter, "support": case.support, "coverage": coverage,
                "symbol_tp": 0, "symbol_fp": 0, "symbol_fn": 0,
                "reference_tp": int(bool(positive)),
                "reference_fp": len(false) + max(0, len(positive) - 1),
                "reference_fn": int(not positive), "actual_positive": positive,
                "actual_negative": false, "unresolved": unresolved,
                "coverage_ok": coverage["status"] == "complete" and
                               coverage["last_success_hash"] == coverage["hash"] and not rows}
    line = case.line or symbol_line(case.source, case.symbol)
    positive = [r for r in rows if r["name"] == case.symbol and r["line"] == line
                and r["kind"] == case.kind and
                (case.qualified is None or r["qualified_name"] == case.qualified)]
    false = [r for r in rows if r["name"] == case.absent or
             (case.qualified is not None and case.absent in r["qualified_name"])]
    # Duplicate declarations of a uniquely labelled site are also false positives.
    extra = max(0, len(positive) - 1)
    parser = str(coverage["parser"]).lower()
    grammar_required = case.adapter not in ADAPTERS_ALLOWED_TO_USE_FALLBACK
    parser_ok = not grammar_required or not any(word in parser for word in ("heuristic", "fallback", "regex"))
    coverage_ok = coverage["status"] == "complete" and coverage["last_success_hash"] == coverage["hash"]
    return {"adapter": case.adapter, "support": case.support, "coverage": coverage,
            "symbol_tp": int(bool(positive)), "symbol_fp": len(false) + extra,
            "symbol_fn": int(not positive), "parser_ok": parser_ok,
            "coverage_ok": coverage_ok, "expected_line": line,
            "actual_positive": positive, "actual_negative": false,
            "unresolved": unresolved}


def score_edge(cg: Path, work: Path, case) -> dict:
    sources = {case.path: case.source, **case.extra_files}
    root = project(work, f"edge-{case.adapter}", sources)
    execute(cg, root, "init")
    with db_open(root) as db:
        rows = edge_rows(db)
        symbols = [r for path in sources for r in symbol_rows(db, path)]
        unresolved = db.execute(
            """SELECT count(*) FROM semantic_references r JOIN files f ON f.id=r.file_id
                WHERE f.path=? AND r.target_id IS NULL""", (case.path,)).fetchone()[0]
    def node_exists(name: str, qualified: str | None) -> bool:
        return any(r["name"] == name and
                   (qualified is None or r["qualified_name"] == qualified)
                   for r in symbols)
    missing_nodes = [name for name, qualified in (
        (case.target, case.target_qualified),
        (case.caller, case.caller_qualified),
        (case.unrelated, case.unrelated_qualified),
    ) if not node_exists(name, qualified)]
    positive = [e for e in rows if e["source_name"] == case.caller
                and e["target_name"] == case.target and e["kind"] == case.kind
                and (case.caller_qualified is None or e["source_qualified"] == case.caller_qualified)
                and (case.target_qualified is None or e["target_qualified"] == case.target_qualified)]
    negative = [e for e in rows if e["source_name"] == case.unrelated
                and e["target_name"] == case.target
                and (case.unrelated_qualified is None or e["source_qualified"] == case.unrelated_qualified)
                and (case.target_qualified is None or e["target_qualified"] == case.target_qualified)]
    evidence_ok = bool(positive) and all(
        e["original_text"] and e["strategy"] and e["provenance"] and
        isinstance(e["start_line"], int) and e["start_line"] > 0
        for e in positive
    )
    return {"adapter": case.adapter, "edge_tp": int(bool(positive)),
            "edge_fp": len(negative) + max(0, len(positive) - 1),
            "edge_fn": int(not positive), "missing_nodes": sorted(missing_nodes),
            "evidence_ok": evidence_ok, "unresolved": unresolved,
            "positive": positive, "negative": negative}


def score_framework(cg: Path, work: Path, case) -> dict:
    root = project(work, f"framework-{case.name}", case.files)
    execute(cg, root, "init")
    with db_open(root) as db:
        files = {path: file_coverage(db, path) for path in case.files}
        routes = route_rows(db)
        edges = edge_rows(db)
        symbols = {path: symbol_rows(db, path) for path in case.files}
    coverage_ok = all(h["status"] == "complete" and h["parser"] and
                      h["last_success_hash"] == h["hash"] for h in files.values())
    positive = [r for r in routes if r["pattern"] == case.path
                and r["framework"] == (case.framework_id or case.name)
                and (r["method"] or "").upper() == case.method]
    forbidden_paths = {case.decoy_path, *case.extra_decoy_paths}
    negative = [r for r in routes if r["pattern"] in forbidden_paths or
                (r["pattern"] == case.path and
                 (r["framework"] != (case.framework_id or case.name) or
                  (r["method"] or "").upper() != case.method)) or
                (str(r["pattern"] or "").startswith("/v16") and r["pattern"] != case.path)]
    handler_symbols = [(p, r) for p, rows in symbols.items() for r in rows
                       if r["name"].lower() == case.handler.lower()]
    # A route must reach the labelled handler in the semantic graph. Merely
    # extracting the path text or a standalone handler does not count.
    linked = [e for e in edges if e["target_name"] and
              e["target_name"].lower() == case.handler.lower() and
              e["source_kind"] == "route" and
              e["kind"] == "route_handler" and
              e["strategy"] == case.strategy and
              e["provenance"] == case.provenance and
              e["channel"] == case.path and
              isinstance(e["registration_line"], int) and e["registration_line"] > 0 and
              e["evidence"]]
    wrong_links = [e for e in edges if any(
        forbidden in " ".join(str(e[k] or "") for k in
            ("original_text", "evidence", "channel", "registration_path"))
        for forbidden in forbidden_paths)]
    wrong_handler_links = [e for e in edges if e["kind"] == "route_handler" and
                           e["channel"] == case.path and e["target_name"] and
                           e["target_name"].lower() != case.handler.lower()]
    return {"framework": case.name, "coverage": files, "coverage_ok": coverage_ok,
            "route_tp": int(bool(positive)),
            "route_fp": len(negative) + max(0, len(positive) - 1) +
                        len(wrong_links) + len(wrong_handler_links) +
                        max(0, len(linked) - 1),
            "route_fn": int(not positive), "handler_tp": int(bool(handler_symbols)),
            "handler_fn": int(not handler_symbols), "edge_tp": int(bool(linked)),
            "edge_fn": int(not linked), "actual_routes": routes,
            "actual_handler_edges": linked}


def ratio(num: int, den: int) -> float | None:
    return round(num / den, 4) if den else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cg", type=Path, default=Path(os.environ.get("CG", "cg")))
    parser.add_argument("--out", type=Path)
    parser.add_argument("--catalog-only", action="store_true")
    args = parser.parse_args()
    structural = {c.adapter for c in CASES if c.support == "structural"}
    edge_adapters = {e.adapter for e in EDGES}
    if edge_adapters != structural:
        raise AssertionError(f"language edge label gap: missing={sorted(structural-edge_adapters)}, "
                             f"extra={sorted(edge_adapters-structural)}")
    if {c.adapter for c in CASES} != REQUIRED_ADAPTERS or \
       {f.name for f in FRAMEWORKS} != REQUIRED_FRAMEWORKS:
        raise AssertionError("advertised adapter or framework has no labelled case")
    if args.catalog_only:
        print(json.dumps({"languages": [c.adapter for c in CASES],
                          "language_edges": [e.adapter for e in EDGES],
                          "frameworks": [f.name for f in FRAMEWORKS]}, indent=2))
        return 0
    cg = args.cg.resolve()
    if not cg.is_file():
        raise SystemExit(f"cg binary not found: {cg}")
    failures = []
    case_errors = {}
    with tempfile.TemporaryDirectory(prefix="codify-semantic-") as name:
        work = Path(name)
        language = []
        language_edges = []
        framework = []
        for case in CASES:
            try:
                language.append(score_language(cg, work, case))
            except (AssertionError, sqlite3.Error) as exc:
                case_errors[f"language:{case.adapter}"] = str(exc)
                failures.append(f"language {case.adapter}: {exc}")
        for case in EDGES:
            try:
                language_edges.append(score_edge(cg, work, case))
            except (AssertionError, sqlite3.Error) as exc:
                case_errors[f"edge:{case.adapter}"] = str(exc)
                failures.append(f"edge {case.adapter}: {exc}")
        for case in FRAMEWORKS:
            try:
                framework.append(score_framework(cg, work, case))
            except (AssertionError, sqlite3.Error) as exc:
                case_errors[f"framework:{case.name}"] = str(exc)
                failures.append(f"framework {case.name}: {exc}")
    edge_by_adapter = {r["adapter"]: r for r in language_edges}
    by_adapter = {}
    for row in language:
        tp, fp, fn = row["symbol_tp"], row["symbol_fp"], row["symbol_fn"]
        by_adapter[row["adapter"]] = {
            "support": row["support"],
            "symbol_precision": ratio(tp, tp + fp), "symbol_recall": ratio(tp, tp + fn),
            "parser": row["coverage"]["parser"], "coverage": row["coverage"]["status"],
            "false_positives": fp, "false_negatives": fn,
            "unresolved_references": row["unresolved"],
        }
        if row["support"] == "reference-only":
            rtp, rfp, rfn = row["reference_tp"], row["reference_fp"], row["reference_fn"]
            by_adapter[row["adapter"]].update({
                "reference_precision": ratio(rtp, rtp + rfp),
                "reference_recall": ratio(rtp, rtp + rfn),
                "reference_false_positives": rfp,
                "reference_false_negatives": rfn,
            })
            if rfp or rfn:
                failures.append(f"reference {row['adapter']}: {by_adapter[row['adapter']]}")
        edge = edge_by_adapter.get(row["adapter"])
        if edge:
            by_adapter[row["adapter"]].update({
                "edge_precision": ratio(edge["edge_tp"], edge["edge_tp"] + edge["edge_fp"]),
                "edge_recall": ratio(edge["edge_tp"], edge["edge_tp"] + edge["edge_fn"]),
                "edge_false_positives": edge["edge_fp"],
                "edge_false_negatives": edge["edge_fn"],
                "edge_unresolved_references": edge["unresolved"],
            })
            if edge["edge_fp"] or edge["edge_fn"] or edge["missing_nodes"] or not edge["evidence_ok"]:
                failures.append(f"edge {row['adapter']}: {edge}")
        if fp or fn or not row.get("parser_ok", True) or not row.get("coverage_ok", True):
            failures.append(f"language {row['adapter']}: {by_adapter[row['adapter']]}")
    by_framework = {}
    for row in framework:
        tp = row["route_tp"] + row["handler_tp"] + row["edge_tp"]
        fn = row["route_fn"] + row["handler_fn"] + row["edge_fn"]
        fp = row["route_fp"]
        by_framework[row["framework"]] = {"precision": ratio(tp, tp + fp),
                                           "recall": ratio(tp, tp + fn),
                                           "false_positives": fp, "false_negatives": fn,
                                           "coverage": {p: {"status": h["status"],
                                                            "parser": h["parser"]}
                                                        for p, h in row["coverage"].items()}}
        if fp or fn or not row["coverage_ok"]:
            failures.append(f"framework {row['framework']}: {by_framework[row['framework']]}")
    result = {"languages": by_adapter, "frameworks": by_framework,
              "labelled_language_cases": len(CASES),
              "labelled_language_edge_cases": len(EDGES),
              "labelled_framework_cases": len(FRAMEWORKS),
              "case_errors": case_errors,
              "failures": failures}
    rendered = json.dumps(result, indent=2, sort_keys=True)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, sqlite3.Error) as exc:
        print(f"semantic conformance: {exc}", file=sys.stderr)
        sys.exit(1)
