#!/usr/bin/env bash
set -eu

# Send the projector power code over the GPIO IR transmitter.
LIRC_DEV="${LIRC_DEV:-/dev/lirc0}"
SCANCODE="${SCANCODE:-nec:0xa8}"
REPEATS="${1:-3}"
GAP_SECS="${GAP_SECS:-0.25}"

if [ ! -e "$LIRC_DEV" ]; then
  echo "IR TX device not found: $LIRC_DEV" >&2
  exit 1
fi

echo "Sending $SCANCODE on $LIRC_DEV ($REPEATS times)..."
i=1
while [ "$i" -le "$REPEATS" ]; do
  ir-ctl -d "$LIRC_DEV" -S "$SCANCODE"
  echo "Sent $i/$REPEATS"
  i=$((i + 1))
  if [ "$i" -le "$REPEATS" ]; then
    sleep "$GAP_SECS"
  fi
done
