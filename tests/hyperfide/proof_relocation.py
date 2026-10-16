"""Trusted read-only relocation policy for the canonical checker.

Only the admission service supplies this file. No sealed evidence is rewritten.
Every source/input/tool file read requires an explicit original-to-staged entry.
"""
import hashlib
import json
import os
from pathlib import Path

class Relocation:
    def __init__(self, mapping, base, require):
        self.require = require
        self.base = Path(base).resolve()
        require(type(mapping) is dict and set(mapping) == {"schema_version", "workspace", "campaign_original", "files", "executables", "checker_original", "runner_original"}, "invalid trusted relocation schema")
        require(type(mapping["schema_version"]) is int and mapping["schema_version"] == 1, "unknown relocation version")
        workspace = mapping["workspace"]
        require(type(workspace) is dict and set(workspace) == {"original", "staged"}, "invalid workspace relocation")
        self.original = self.absolute(workspace["original"])
        self.staged = self.relative(workspace["staged"], directory=True)
        self.campaign_original = self.absolute(mapping["campaign_original"])
        self.files = {}
        self.reverse = {}
        require(type(mapping["files"]) is list and 0 < len(mapping["files"]) <= 100000, "explicit relocated file inventory required")
        for item in mapping["files"]:
            require(type(item) is dict and set(item) == {"original", "staged"}, "invalid relocated file")
            original = self.absolute(item["original"])
            staged = self.relative(item["staged"])
            require(original not in self.files and staged not in self.reverse, "duplicate relocation identity")
            if original.is_relative_to(self.original):
                require(staged == self.staged / original.relative_to(self.original), "workspace file relocation changes relative identity")
            self.files[original] = staged
            self.reverse[staged] = original
        self.executables = {}
        require(type(mapping["executables"]) is list and len(mapping["executables"]) <= 128, "executable mapping required")
        for item in mapping["executables"]:
            require(type(item) is dict and set(item) == {"original", "argv0"}, "invalid executable identity")
            original = self.absolute(item["original"])
            require(original in self.files and original not in self.executables and type(item["argv0"]) is str and bool(item["argv0"]), "unmapped/duplicate executable")
            self.executables[original] = item["argv0"]
        self.checker_original = self.absolute(mapping["checker_original"])
        self.runner_original = self.absolute(mapping["runner_original"])
        require(self.checker_original.name == "check-evidence.py" and self.runner_original == self.checker_original.with_name("qualify.py"), "invalid canonical tool identities")
        require(self.checker_original in self.files and self.runner_original in self.files, "canonical tool source unmapped")

    def absolute(self, value):
        self.require(type(value) is str and value.startswith("/") and "\x00" not in value and ".." not in Path(value).parts and str(Path(value)) == value, "invalid original absolute identity")
        return Path(value)

    def relative(self, value, directory=False):
        self.require(type(value) is str and value and not Path(value).is_absolute() and all(part not in ("..", ".", "") for part in value.split("/")), "invalid staged relative path")
        path = self.base
        for part in Path(value).parts:
            path /= part
            self.require(not path.is_symlink(), "symbolic staged evidence forbidden")
        self.require(path.resolve().is_relative_to(self.base), "staged evidence escapes trusted root")
        self.require(path.is_dir() if directory else path.is_file(), "staged evidence missing")
        return path

    def file(self, original):
        original = Path(original)
        self.require(original in self.files, "sealed file has no explicit trusted relocation")
        target = self.files[original]
        self.relative(target.relative_to(self.base).as_posix())
        self.require(not target.is_symlink() and target.is_file(), "relocated file missing or symbolic")
        return target

    def directory(self, original):
        original = Path(original)
        if original == self.original or original.is_relative_to(self.original):
            return self.staged / original.relative_to(self.original)
        self.require(original == self.campaign_original, "directory has no trusted relocation")
        return self.campaign_staged

    def logical(self, staged):
        staged = Path(staged)
        if staged in self.reverse:
            return self.reverse[staged]
        self.require(staged.is_relative_to(self.staged), "observed file lacks original workspace identity")
        return self.original / staged.relative_to(self.staged)

    def executable(self, command, original):
        original = Path(original)
        self.require(self.executables.get(original) == command["argv"][0], "executable argv identity differs from trusted mapping")
        return self.file(original)
