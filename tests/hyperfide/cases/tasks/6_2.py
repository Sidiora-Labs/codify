#!/usr/bin/env python3
"""Registered domain06 component runner; full-case qualification stays separate."""
import importlib.util
from pathlib import Path
import sys
spec=importlib.util.spec_from_file_location("events_real_tests",Path(__file__).with_name("6_1.py"))
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
if __name__=="__main__":sys.exit(runner.main('6.2'))
