#!/bin/bash
# HoloHead launcher. Keeps the Mac awake, opens the console on the main screen and the
# projection fullscreen on the second screen, and reopens the projection if it closes.
# Stop it with stop.sh.
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

LOG="$HH_DIR/holohead.log"
PIDFILE="$HH_DIR/.holohead.pid"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

# Only one launcher at a time.
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  log "HoloHead is already running (pid $(cat "$PIDFILE"))."
  exit 0
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

if [ -z "$ROOM" ]; then
  log "No ROOM set. Run install.sh, or put ROOM=yourcode in $HH_DIR/config.local."
  exit 1
fi

CHROME="$(find_chrome)" || { chrome_missing_help | tee -a "$LOG"; exit 1; }
CHROME_BIN="$CHROME/Contents/MacOS/Google Chrome"
FLAGS=(--no-first-run --no-default-browser-check --noerrdialogs
       --disable-session-crashed-bubble --hide-crash-restore-bubble
       --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream
       --disable-features=Translate,MediaRouter --disable-background-timer-throttling
       --disable-renderer-backgrounding --disable-backgrounding-occluded-windows)

# Keep the display awake for as long as this script runs (built in, no admin needed).
caffeinate -d -i -w $$ &

# At login the second screen can take a few seconds to appear.
for _ in $(seq 1 15); do
  [ "$(list_screens | wc -l)" -ge 2 ] && break
  sleep 2
done

start_console() {
  "$CHROME_BIN" --user-data-dir="$HH_DIR/profile-console" "${FLAGS[@]}" \
    --app="$(page_url console)" --window-position=60,60 --window-size=1400,950 >/dev/null 2>&1 &
}

start_projection() {
  local other pos extra=""
  other="$(list_screens | awk '$5 == "other" { print $1 "," $2; exit }')"
  pos="${PROJ_POS:-$other}"
  if [ -z "$pos" ]; then
    log "Only one screen found: showing the face in TV mode on the main screen."
    pos="0,0"
    extra="tv=1"
  else
    log "Projection on the screen at $pos."
  fi
  "$CHROME_BIN" --user-data-dir="$HH_DIR/profile-projection" "${FLAGS[@]}" \
    --kiosk --app="$(page_url projection "$extra")" --window-position="$pos" >/dev/null 2>&1 &
  PROJ_PID=$!
}

log "Starting HoloHead (room $ROOM, Chrome at $CHROME)."
start_projection
sleep 3
start_console

# Watchdog: reopen the projection if it closes or crashes (but give up if it keeps dying).
crashes=()
while true; do
  wait "$PROJ_PID" 2>/dev/null
  now=$(date +%s)
  crashes=("${crashes[@]}" "$now")
  recent=0
  for t in "${crashes[@]}"; do [ $((now - t)) -lt 120 ] && recent=$((recent + 1)); done
  if [ "$recent" -ge 5 ]; then
    log "The projection closed 5 times in 2 minutes. Stopping; check holohead.log and run preflight.sh."
    exit 1
  fi
  log "Projection closed. Reopening in 3 seconds."
  sleep 3
  start_projection
done
