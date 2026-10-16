#!/usr/bin/env python3
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location("assurance_bounded",Path(__file__).with_name("16_1.py"))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
raise SystemExit(module.main("16.3"))
