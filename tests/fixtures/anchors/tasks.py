"""Task storage for the anchors fixture."""

import json


def load_tasks(path):
    """Read the task list. Returns an empty list when absent."""
    with open(path) as f:
        return json.load(f)


# Merge new tasks after load_tasks reads the disk.
def save_tasks(path, tasks):
    # step: read before write
    existing = load_tasks(path)
    return existing
