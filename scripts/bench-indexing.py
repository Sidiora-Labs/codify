#!/usr/bin/env python3
"""Repeatable, source-backed indexing resource and latency measurements.

The default fixture is intentionally small for CI. --profile large is opt-in.
All source bytes come from tests/scale/gen.py and a fixed seed. JSON contains
raw runs, fixture parameters, per-phase timers, coverage and database sizes.
"""
import argparse
import json
import os
from pathlib import Path
import resource
import sqlite3
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parent.parent


def command(args, cwd, env=None):
    start = time.perf_counter_ns()
    before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    p = subprocess.Popen(args, cwd=cwd, env=env, text=True,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    peak = 0
    while True:
        try:
            stdout, stderr = p.communicate(timeout=0.01)
            break
        except subprocess.TimeoutExpired:
            try:
                for line in Path(f"/proc/{p.pid}/status").read_text().splitlines():
                    if line.startswith("VmHWM:"):
                        peak = max(peak, int(line.split()[1]))
                        break
            except (FileNotFoundError, PermissionError):
                pass
    wall = (time.perf_counter_ns() - start) // 1_000_000
    after = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    if p.returncode:
        raise RuntimeError(f"{args!r} exited {p.returncode}: {stderr[-1200:]}")
    return stdout, {"wall_ms": wall,
                    "child_peak_rss_kb": peak or (after if after > before else None)}


def db_size(db):
    return {
        "main_bytes": db.stat().st_size if db.exists() else 0,
        "wal_bytes": Path(str(db) + "-wal").stat().st_size
        if Path(str(db) + "-wal").exists() else 0,
    }


def coverage(db):
    with sqlite3.connect(db) as c:
        table = c.execute("SELECT 1 FROM sqlite_master WHERE type='table' "
                          "AND name='extraction_health'").fetchone()
        if not table:
            return {"available": False}
        rows = c.execute("SELECT status,count(*) FROM extraction_health "
                         "GROUP BY status").fetchall()
        diagnostics = c.execute("SELECT count(*) FROM extraction_health "
                                "WHERE reason<>''").fetchone()[0]
        return {"available": True, "status": dict(rows),
                "diagnostic_files": diagnostics}


def stage(cg, root, db, name, flags, env):
    out, timing = command([str(cg), *flags, "--json"], root, env)
    try:
        stats = json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"{name} returned invalid JSON: {out[-500:]}") from e
    if stats.get("busy") or stats.get("coalesced"):
        raise RuntimeError(f"{name} did not complete: {stats}")
    return {**timing, "stats": stats, "database": db_size(db),
            "coverage": coverage(db)}


def compare_baseline(current, baseline, factor, floor_ms):
    """Report measured regressions; latency floor absorbs timer granularity."""
    findings = []
    for name, now in current["stages"].items():
        old = baseline.get("stages", {}).get(name)
        if not old:
            continue
        prev = old.get("wall_ms")
        if isinstance(prev, (int, float)) and prev > 0:
            limit = max(floor_ms, prev * factor)
            if now["wall_ms"] > limit:
                findings.append({"stage": name, "metric": "wall_ms",
                                 "actual": now["wall_ms"], "limit": limit})
        for metric in ("peak_rss_kb",):
            prior = old.get("stats", {}).get(metric)
            actual = now.get("stats", {}).get(metric)
            if isinstance(prior, (int, float)) and prior > 0 and actual > prior * factor:
                findings.append({"stage": name, "metric": metric,
                                 "actual": actual, "limit": prior * factor})
    return findings


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--cg", type=Path, default=ROOT / "cg")
    ap.add_argument("--profile", choices=("small", "large"), default="small")
    ap.add_argument("--files", type=int)
    ap.add_argument("--lines", type=int)
    ap.add_argument("--seed", type=int, default=15)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--max-rss-mb", type=int, default=1024)
    ap.add_argument("--max-db-ratio", type=float, default=500)
    ap.add_argument("--baseline", type=Path)
    ap.add_argument("--regression-factor", type=float, default=2.0)
    ap.add_argument("--latency-floor-ms", type=int, default=250)
    ap.add_argument("--output", type=Path)
    ap.add_argument("--keep", type=Path)
    a = ap.parse_args()
    if a.workers < 1 or a.workers > 64 or a.max_rss_mb < 1 or a.max_db_ratio <= 0:
        ap.error("resource limits and workers must be positive (workers <=64)")
    files = a.files or (40 if a.profile == "small" else 1000)
    lines = a.lines or (2000 if a.profile == "small" else 100000)
    if files < 10 or lines < files * 10:
        ap.error("fixture needs at least 10 files and 10 lines per file")
    cg = a.cg.resolve()
    if not cg.is_file() or not os.access(cg, os.X_OK):
        ap.error(f"binary is not executable: {cg}")
    if a.keep:
        work = a.keep.resolve()
        work.mkdir(parents=True, exist_ok=True)
        temp = None
    else:
        temp = tempfile.TemporaryDirectory(prefix="codify-index-bench-")
        work = Path(temp.name)
    project = work / "project"
    if project.exists():
        ap.error(f"fixture path already exists: {project}")
    project.mkdir()
    env = os.environ.copy()
    env.pop("OPENROUTER_API_KEY", None)
    env["CG_INDEX_WORKERS"] = str(a.workers)
    env["CG_PROGRESS"] = "0"
    gen, _ = command([sys.executable, str(ROOT / "tests/scale/gen.py"),
                      str(project), "--files", str(files), "--lines", str(lines),
                      "--seed", str(a.seed)], project, env)
    (project / ".gitignore").write_text(".codegraph/\n")
    command(["git", "init", "-q", "-b", "main", "."], project, env)
    command(["git", "add", "-A"], project, env)
    command(["git", "-c", "user.email=bench@local", "-c", "user.name=Bench",
             "commit", "-qm", "fixture"], project, env)
    base, _ = command(["git", "rev-parse", "HEAD"], project, env)
    source_bytes = sum(p.stat().st_size for p in project.rglob("*")
                       if p.is_file() and ".git" not in p.parts)
    db = project / ".codegraph" / "graph.db"
    init_out, cold = command([str(cg), "init"], project, env)
    if not db.exists():
        raise RuntimeError("cold index did not create a graph database")
    result = {
        "format": "codify-index-benchmark-v1",
        "fixture": {"generator": "tests/scale/gen.py", "files": files,
                    "lines_requested": lines, "seed": a.seed,
                    "source_bytes": source_bytes, "generator_output": gen.strip(),
                    "git_base": base.strip()},
        "settings": {"workers": a.workers, "profile": a.profile,
                     "max_rss_mb": a.max_rss_mb,
                     "max_db_ratio": a.max_db_ratio},
        "stages": {"cold": {**cold, "output": init_out.strip(),
                             "database": db_size(db), "coverage": coverage(db)}},
    }
    stages = result["stages"]
    stages["noop"] = stage(cg, project, db, "noop", ["sync", "--workers", str(a.workers)], env)
    ts_files = sorted(project.rglob("*.ts"))
    if len(ts_files) < 3:
        raise RuntimeError("fixture did not contain enough TypeScript files")
    edit, delete, rename = ts_files[:3]
    edit.write_text(edit.read_text() + "\nexport function ResourceProbe(): number { return 7; }\n")
    stamp = time.perf_counter_ns()
    stages["edit"] = stage(cg, project, db, "edit", ["sync", "--workers", str(a.workers)], env)
    search, search_timing = command([str(cg), "search", "ResourceProbe"], project, env)
    if "ResourceProbe" not in search:
        raise RuntimeError("edited symbol did not reach query results")
    result["source_to_query_ms"] = (time.perf_counter_ns() - stamp) // 1_000_000
    result["query_wall_ms"] = search_timing["wall_ms"]
    delete.unlink()
    stages["delete"] = stage(cg, project, db, "delete", ["sync", "--workers", str(a.workers)], env)
    renamed = rename.with_name(rename.stem + "_moved.ts")
    rename.rename(renamed)
    stages["rename"] = stage(cg, project, db, "rename", ["sync", "--workers", str(a.workers)], env)
    command(["git", "add", "-A"], project, env)
    command(["git", "-c", "user.email=bench@local", "-c", "user.name=Bench",
             "commit", "-qm", "changes"], project, env)
    changed, _ = command(["git", "rev-parse", "HEAD"], project, env)
    result["fixture"]["git_changed"] = changed.strip()
    command(["git", "reset", "--hard", base.strip()], project, env)
    stages["replay_back"] = stage(cg, project, db, "replay_back",
                                  ["sync", "--workers", str(a.workers)], env)
    command(["git", "reset", "--hard", changed.strip()], project, env)
    stages["replay_forward"] = stage(cg, project, db, "replay_forward",
                                     ["sync", "--workers", str(a.workers)], env)
    stages["full"] = stage(cg, project, db, "full",
                            ["index", "--full", "--workers", str(a.workers)], env)

    errors = []
    for name, run in stages.items():
        stats = run.get("stats")
        if not stats:
            continue
        if stats.get("workers", 0) > a.workers:
            errors.append(f"{name}: workers {stats['workers']} exceed {a.workers}")
        if stats.get("peak_rss_kb", 0) > a.max_rss_mb * 1024:
            errors.append(f"{name}: peak RSS exceeds {a.max_rss_mb} MiB")
        for phase, ms in stats.get("phase_ms", {}).items():
            if ms < 0:
                errors.append(f"{name}: negative {phase} phase")
    if stages["noop"]["stats"].get("indexed") != 0:
        errors.append("no-op sync indexed files")
    if stages["edit"]["stats"].get("indexed", 0) < 1:
        errors.append("edit did not index a file")
    if stages["delete"]["stats"].get("removed", 0) < 1:
        errors.append("delete did not remove a file")
    if stages["rename"]["stats"].get("removed", 0) < 1:
        errors.append("rename did not remove the old path")
    if stages["replay_back"]["stats"].get("indexed", 0) < 1 or \
       stages["replay_forward"]["stats"].get("indexed", 0) < 1:
        errors.append("commit replay did not refresh changed source")
    final_bytes = sum(stages["full"]["database"].values())
    if final_bytes > source_bytes * a.max_db_ratio:
        errors.append("database growth exceeds configured source ratio")
    if a.baseline:
        errors.extend(compare_baseline(result, json.loads(a.baseline.read_text()),
                                       a.regression_factor, a.latency_floor_ms))
    result["regressions"] = errors
    payload = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if a.output:
        a.output.write_text(payload)
    sys.stdout.write(payload)
    if temp:
        temp.cleanup()
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
