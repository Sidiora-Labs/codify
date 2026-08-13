#!/usr/bin/env bash
# Codify uninstaller — https://codify.centra.ag
#   curl -fsSL https://codify.centra.ag/uninstall | bash
set -euo pipefail

found=0
for dir in /usr/local/bin "$HOME/.local/bin"; do
    [ -x "$dir/cg" ] || continue
    found=1
    if [ -w "$dir/cg" ]; then
        rm -f "$dir/cg"
    elif command -v sudo >/dev/null 2>&1; then
        sudo rm -f "$dir/cg"
    else
        printf 'codify uninstall: no permission to remove %s/cg\n' "$dir" >&2
        exit 1
    fi
    printf 'removed %s/cg\n' "$dir"
done

if [ "$found" -eq 0 ]; then
    printf 'codify uninstall: cg not found in /usr/local/bin or ~/.local/bin\n'
    exit 0
fi

printf 'note: per-project .codegraph/ directories were left untouched;\n'
printf 'delete them per project to remove indexes and snapshots.\n'
