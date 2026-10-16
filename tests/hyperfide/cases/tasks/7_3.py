#!/usr/bin/env python3
"""Run the real domain07 component fixture for this task only."""
import importlib.util
from pathlib import Path
import sys
spec=importlib.util.spec_from_file_location("graph_domain_fixture",Path(__file__).with_name("7_2.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if __name__=="__main__":
    sys.exit(module.cleanup() if "--cleanup" in sys.argv else module.main("7.3"))
