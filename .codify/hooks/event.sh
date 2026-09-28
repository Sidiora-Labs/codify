#!/bin/sh
# codify-owned: portable-event-shim v1
source_name=${1:-generic}
exec cg event ingest --source "$source_name"
