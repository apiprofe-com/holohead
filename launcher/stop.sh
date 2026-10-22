#!/bin/bash
# Stop HoloHead: the launcher, its keep-awake, and its two Chrome windows.
# Your normal Chrome is not touched.
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

PIDFILE="$HH_DIR/.holohead.pid"
if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null
  rm -f "$PIDFILE"
fi
pkill -f -- "--user-data-dir=$HH_DIR/profile-" 2>/dev/null
echo "HoloHead stopped."
