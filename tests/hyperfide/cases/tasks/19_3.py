#!/usr/bin/env python3
"""Task 19.3: actual Git/PG/registered-service integration component probes."""
import os
from pathlib import Path
import runpy
os.environ["HYPERFIDE_INTEGRATION_TEST_TASK"]="19.3"
# Fixture Git must not detach auto-maintenance/gc processes that outlive the probe.
os.environ.update({"GIT_CONFIG_COUNT":"2","GIT_CONFIG_KEY_0":"maintenance.auto","GIT_CONFIG_VALUE_0":"false","GIT_CONFIG_KEY_1":"gc.auto","GIT_CONFIG_VALUE_1":"0"})
runpy.run_path(str(Path(__file__).with_name("19_1.py")),run_name="__main__")
