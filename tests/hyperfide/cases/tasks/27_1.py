#!/usr/bin/env python3
"""Task 27.1 component probe; controlled subprocess checks, never full V-056."""
from pathlib import Path
import subprocess
import sys

if __name__ == "__main__":
    selftest = Path(__file__).resolve().parents[2] / "selftest_harness.py"
    completed = subprocess.run([sys.executable, str(selftest), "--json"], check=False)
    raise SystemExit(completed.returncode)
