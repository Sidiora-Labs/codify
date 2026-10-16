"""Trusted read-only relocation policy for the canonical checker.

Only the admission service supplies this file. No sealed evidence is rewritten.
Every source/input/tool file read requires an explicit original-to-staged entry.
"""
import hashlib
import json
import os
from pathlib import Path

def guard_staging(root, require):
    root = Path(root)
    stat = root.lstat()
    require(root.is_dir() and not root.is_symlink() and stat.st_uid == os.geteuid() and (stat.st_mode & 0o777) == 0o700, "private service-owned staging root required")
    for index, path in enumerate(root.rglob("*")):
        require(index < 200000, "staging inventory exceeds bound")
        stat = path.lstat()
        require(not path.is_symlink() and stat.st_uid == os.geteuid() and not (stat.st_mode & 0o022), "staging is accessible to untrusted writers")
        require(path.is_dir() or (path.is_file() and stat.st_nlink == 1), "staging requires regular nonlinked files")


class Relocation:
    def __init__(self, mapping, base, require):
        self.require = require
        self.base = Path(base).resolve()
        guard_staging(self.base, require)
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


GIT_IDENTITY = None

def safe_git(workspace, arguments, require, portable=False):
    global GIT_IDENTITY
    """Read Git state without evaluating repository/global executable helpers.

    Filtered/LFS or other non-neutral configurations are unsupported and reject.
    This does not replace source, worktree or commit comparisons.
    """
    import re
    import subprocess
    marker = Path(workspace) / ".git"
    require(not marker.is_symlink(), "symbolic Git metadata forbidden")
    if marker.is_dir():
        gitdir = marker
    else:
        require(not portable and marker.is_file(), "portable source requires standalone Git metadata")
        raw = marker.read_text()
        require(raw.startswith("gitdir: ") and len(raw.splitlines()) == 1, "unsupported Git metadata marker")
        gitdir = (marker.parent / raw[8:].strip()).resolve()
    common = gitdir / "commondir"
    if common.exists():
        require(not portable and not common.is_symlink(), "portable shared Git metadata forbidden")
        gitdir = (gitdir / common.read_text().strip()).resolve()
    require(not (gitdir / "config.worktree").exists(), "worktree-specific Git config unsupported")
    require(not (gitdir / "objects/info/alternates").exists(), "external Git object stores unsupported")
    config = gitdir / "config"
    require(config.is_file() and not config.is_symlink() and config.stat().st_size <= 65536, "neutral local Git config required")
    # Git and generic INI parsers have different continuation grammars. Accept
    # only the single-line subset emitted by our neutral staging preparation.
    section = None
    seen = set()
    for line in config.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", ";")):
            continue
        if stripped.startswith("["):
            require(line == stripped and stripped.endswith("]"), "ambiguous Git section syntax unsupported")
            section = stripped[1:-1]
            if section == "core":
                allowed = {"repositoryformatversion", "filemode", "bare", "logallrefupdates", "symlinks", "ignorecase", "precomposeunicode"}
            elif section == "extensions":
                allowed = {"objectformat"}
            elif re.fullmatch(r'remote "[^"\n\\]+"', section):
                allowed = {"url", "fetch", "promisor", "partialclonefilter"}
            elif re.fullmatch(r'branch "[^"\n\\]+"', section):
                allowed = {"remote", "merge"}
            elif section == "user":
                allowed = {"name", "email"}
            elif section == "gc":
                allowed = {"auto", "autodetach"}
            elif section == "maintenance":
                allowed = {"auto"}
            else:
                require(False, "non-neutral Git configuration is unsupported")
        else:
            match = re.fullmatch(r"[ \t]+([A-Za-z][A-Za-z0-9-]*)[ \t]*=[ \t]*(.*)", line)
            require(section is not None and match is not None, "ambiguous Git value syntax unsupported")
            key, value = match.group(1).lower(), match.group(2)
            require(key in allowed and (section, key) not in seen, "non-neutral or duplicate Git key unsupported")
            require(not any(character in value for character in ('\\', '"', '\x00')), "quoted or continued Git values unsupported")
            seen.add((section, key))
    # Git's environment config can inject helpers even when .git/config is clean.
    env = {"PATH": os.defpath, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
    env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_SYSTEM=os.devnull,
               GIT_CONFIG_GLOBAL=os.devnull, GIT_ATTR_NOSYSTEM="1", GIT_OPTIONAL_LOCKS="0", GIT_NO_LAZY_FETCH="1")
    git_binary = Path("/usr/bin/git")
    require(git_binary.is_file() and not git_binary.is_symlink(), "fixed deployment Git executable missing")
    stat = git_binary.stat()
    require(stat.st_uid == 0 and not (stat.st_mode & 0o022), "Git executable is not owned and protected by deployment")
    with git_binary.open("rb") as stream:
        before = hashlib.file_digest(stream, "sha256").hexdigest()
    result = subprocess.run([str(git_binary), "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
                           "-c", "core.attributesFile=/dev/null", "-c", "protocol.allow=never",
                           "-c", "protocol.file.allow=never", "-c", "protocol.ext.allow=never", "-c", "maintenance.auto=false",
                           "-c", "gc.auto=0", "-c", "gc.autoDetach=false", "-C", str(workspace)] + arguments,
                          env=env, capture_output=True, timeout=30)

    with git_binary.open("rb") as stream:
        require(hashlib.file_digest(stream, "sha256").hexdigest() == before, "deployment Git executable changed during inspection")
    GIT_IDENTITY = {"path": str(git_binary), "sha256": before, "size": stat.st_size}
    return result
