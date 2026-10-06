"""Report counts across a directory using the tally binary."""
import subprocess


def tally(path):
    return int(subprocess.check_output(["./tally", "count", path]))


def report(paths):
    return {p: tally(p) for p in paths}
