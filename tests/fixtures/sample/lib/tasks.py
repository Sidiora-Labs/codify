"""Task persistence for the sample fixture."""

import json


def load_tasks(path):
    with open(path) as f:
        return json.load(f)


def save_tasks(path, tasks):
    existing = load_tasks(path)
    existing.extend(tasks)
    with open(path, "w") as f:
        json.dump(existing, f)


class TaskStore:
    def __init__(self, path):
        self.path = path

    def all(self):
        return load_tasks(self.path)
