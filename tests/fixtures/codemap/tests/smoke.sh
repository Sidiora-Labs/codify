#!/bin/sh
# smoke test: the built binary counts a known file
set -e
printf 'one two three\n' > /tmp/tally.in
[ "$(./tally count /tmp/tally.in)" = 3 ]
