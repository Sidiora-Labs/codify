#!/usr/bin/env python3
from pathlib import Path
import importlib.util,sys
spec=importlib.util.spec_from_file_location("domain21_tests",Path(__file__).with_name("21_4.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
if __name__=="__main__":sys.exit(module.run_task("21.2"))
