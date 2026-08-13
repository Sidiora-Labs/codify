#!/usr/bin/env bash
# Codify installer/updater — https://codify.centra.ag
#   curl -fsSL https://codify.centra.ag/install | bash
# Env overrides: CODIFY_INSTALL_DIR (target directory), CODIFY_BASE_URL.
set -euo pipefail

BASE="${CODIFY_BASE_URL:-https://codify.centra.ag}"

# ---- colors (skipped when not a tty or NO_COLOR is set) ----
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    B=$'\033[1m'; DIM=$'\033[2m'; ACC=$'\033[38;5;208m'
    NAVY=$'\033[38;5;24m'; GRN=$'\033[32m'; R=$'\033[0m'
else
    B=""; DIM=""; ACC=""; NAVY=""; GRN=""; R=""
fi

say()  { printf '%s\n' "$*"; }
die()  { printf 'codify install: %s\n' "$*" >&2; exit 1; }

# ---- platform ----
os="$(uname -s)"; arch="$(uname -m)"
[ "$os" = "Linux" ] || die "prebuilt binaries are Linux-only for now — build from source: https://github.com/sidiora-labs/codify (make && sudo make install)"
[ "$arch" = "x86_64" ] || die "prebuilt binaries are x86_64-only for now ($arch detected) — build from source: https://github.com/sidiora-labs/codify"

command -v curl >/dev/null || die "curl is required"

# ---- versions ----
new_ver="$(curl -fsSL "$BASE/VERSION")" || die "could not reach $BASE"
old_ver=""
if command -v cg >/dev/null 2>&1; then
    old_ver="$(cg --version 2>/dev/null || true)"
fi

if [ -n "$old_ver" ] && [ "$old_ver" = "$new_ver" ]; then
    say "${B}cg $old_ver${R} is already the latest version. Nothing to do."
    exit 0
fi

# ---- download + verify ----
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say "${DIM}downloading cg $new_ver ...${R}"
curl -fsSL "$BASE/cg" -o "$tmp/cg"
want="$(curl -fsSL "$BASE/cg.sha256" | awk '{print $1}')"
got="$(sha256sum "$tmp/cg" | awk '{print $1}')"
[ "$want" = "$got" ] || die "checksum mismatch (expected $want, got $got) — aborting"
chmod +x "$tmp/cg"

# ---- choose install dir ----
if [ -n "${CODIFY_INSTALL_DIR:-}" ]; then
    dir="$CODIFY_INSTALL_DIR"
    mkdir -p "$dir"
    install -m 755 "$tmp/cg" "$dir/cg"
elif [ -w /usr/local/bin ]; then
    dir=/usr/local/bin
    install -m 755 "$tmp/cg" "$dir/cg"
elif command -v sudo >/dev/null 2>&1; then
    dir=/usr/local/bin
    say "${DIM}installing to $dir (sudo)${R}"
    sudo install -m 755 "$tmp/cg" "$dir/cg"
else
    dir="$HOME/.local/bin"
    mkdir -p "$dir"
    install -m 755 "$tmp/cg" "$dir/cg"
fi

# ---- banner ----
say ""
say "${NAVY}  ██████╗ ██████╗ ██████╗ ██╗███████╗██╗   ██╗${R}"
say "${NAVY} ██╔════╝██╔═══██╗██╔══██╗██║██╔════╝╚██╗ ██╔╝${R}"
say "${NAVY} ██║     ██║   ██║██║  ██║██║█████╗   ╚████╔╝ ${R}"
say "${NAVY} ██║     ██║   ██║██║  ██║██║██╔══╝    ╚██╔╝  ${R}"
say "${NAVY} ╚██████╗╚██████╔╝██████╔╝██║██║        ██║   ${R}"
say "${NAVY}  ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝╚═╝        ╚═╝   ${R}"
say ""
if [ -n "$old_ver" ]; then
    say " ${GRN}updated${R} ${B}cg $old_ver -> $new_ver${R} in $dir"
else
    say " ${GRN}installed${R} ${B}cg $new_ver${R} to $dir"
fi
say " ${DIM}the agent workflow tool — from small projects to large codebases${R}"
say ""
say " quick start:"
say "   ${ACC}cg init${R}            ${DIM}index this project (graph + snapshots)${R}"
say "   ${ACC}cg context <q>${R}     ${DIM}one-call context for any area of the code${R}"
say "   ${ACC}cg mcp-install${R}     ${DIM}connect Claude Code, Cursor, VS Code, ...${R}"
say "   ${ACC}cg spec${R}            ${DIM}task board (repos with spec/workflow.kvx)${R}"
say ""
say " docs: ${B}https://github.com/sidiora-labs/codify${R}"

case ":$PATH:" in
    *:"$dir":*) ;;
    *) say ""; say " ${B}note:${R} $dir is not on your PATH — add:  export PATH=\"$dir:\$PATH\"" ;;
esac
