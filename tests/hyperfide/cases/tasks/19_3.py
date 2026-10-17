#!/usr/bin/env python3
"""Task 19.3: actual Git/PG/registered-service integration component probes."""
import os
from pathlib import Path
import runpy
os.environ["HYPERFIDE_INTEGRATION_TEST_TASK"]="19.3"
runpy.run_path(str(Path(__file__).with_name("19_1.py")),run_name="__main__")
