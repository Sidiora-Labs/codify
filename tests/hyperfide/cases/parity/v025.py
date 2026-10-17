#!/usr/bin/env python3
"""Full-case V-025 parity probe; BLOCKED until an approved parity manifest and bridges exist."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "campaigns"))
import parity

if __name__ == "__main__":
    raise SystemExit(parity.main_case("V-025"))
