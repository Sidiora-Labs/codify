"""Nightly backup helpers for the notes database."""
import json


def rotate_archives(folder, keep):
    """Delete the oldest archives in folder until only keep remain."""
    names = sorted(folder.iterdir())
    for old in names[:-keep]:
        old.unlink()


def snapshot_notes(rows, path):
    """Serialize the notes table to a dated archive on disk."""
    with open(path, "w") as fh:
        json.dump(rows, fh)
    return len(rows)
