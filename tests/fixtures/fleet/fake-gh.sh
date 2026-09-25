#!/usr/bin/env bash
# A stand-in for gh, pointed at by CG_GH in 26_fleet.sh.
#
# cg runs it from the main worktree for three things:
#   pr list   --base B [--head H] --state open --json ...
#             → the PRs in $GH_FAKE_DIR/prs.json (filtered by --head when
#               given), or [] when there is no such file
#   pr create --base B --head H --title T --body-file F
#             → prints the new PR's URL, like gh
#   pr merge N --merge
#             → "✓ Merged pull request #N"; fails when $GH_FAKE_DIR/fail-merge
#               lists N, so a checkpoint can be made to stop
# Every call's arguments are appended to $GH_FAKE_DIR/calls.txt, one line each.
set -u
dir="${GH_FAKE_DIR:?GH_FAKE_DIR must be set}"
mkdir -p "$dir"
printf '%s\n' "$*" >> "$dir/calls.txt"
case "${1:-} ${2:-}" in
    "pr list")
        head=""
        while [ $# -gt 0 ]; do
            case "$1" in --head) head="$2"; shift ;; esac
            shift
        done
        if [ -f "$dir/prs.json" ]; then
            python3 - "$dir/prs.json" "$head" <<'EOF'
import json, sys
prs = json.load(open(sys.argv[1]))
h = sys.argv[2]
print(json.dumps([p for p in prs if not h or p["headRefName"] == h]))
EOF
        else
            echo "[]"
        fi ;;
    "pr create")
        echo "Creating pull request for ${6:-?} into ${4:-?} in acme/repo" >&2
        echo "https://github.com/acme/repo/pull/7" ;;
    "pr merge")
        n="${3:-0}"
        if [ -f "$dir/fail-merge" ] && grep -qx "$n" "$dir/fail-merge"; then
            echo "X Pull request #$n is not mergeable: the base branch policy prohibits the merge." >&2
            exit 1
        fi
        echo "✓ Merged pull request #$n" ;;
    *)
        echo "fake gh: unexpected arguments: $*" >&2
        exit 2 ;;
esac
