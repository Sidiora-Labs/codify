#!/bin/sh
# codify-owned: claude-event-shim v1
exec "$(dirname "$0")/event.sh" claude
