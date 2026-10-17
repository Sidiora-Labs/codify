#!/usr/bin/env python3
"""Task 19.4: actual Git/PG/registered-service integration component probes."""
import os
from pathlib import Path
import runpy
os.environ["HYPERFIDE_INTEGRATION_TEST_TASK"]="19.4"
# Fixture Git commands must not detach auto-maintenance children: an orphaned
# background git outlives the probe and is a leaked descendant to qualify.py.
os.environ.update({"GIT_CONFIG_COUNT":"1","GIT_CONFIG_KEY_0":"maintenance.auto","GIT_CONFIG_VALUE_0":"false"})
runpy.run_path(str(Path(__file__).with_name("19_1.py")),run_name="__main__")
