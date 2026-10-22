#!/bin/bash
# HoloHead preflight: checks this Mac can run the head. Prints PASS/FAIL for each check.
# Changes nothing and never asks for admin rights.
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

fails=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; fails=$((fails + 1)); }
info() { printf '  INFO  %s\n' "$1"; }

echo "HoloHead preflight ($(date '+%Y-%m-%d %H:%M'))"
echo

# 1. Chrome runs from a user folder
if CHROME="$(find_chrome)"; then
  if ver="$("$CHROME/Contents/MacOS/Google Chrome" --version 2>/dev/null)"; then
    pass "Chrome starts: $ver ($CHROME)"
  else
    fail "Chrome found but won't start ($CHROME)" \
         "The college's device management may be blocking it. Ask IT to allow Google Chrome, or use Safari as a fallback."
  fi
else
  fail "Chrome not found" "Download Chrome and drag it into $HH_DIR or ~/Documents (not Applications)."
fi

# 2. Camera and microphone are present
if system_profiler SPCameraDataType 2>/dev/null | grep -q "Model ID"; then
  pass "Camera found"
else
  fail "No camera found" "Plug in a USB webcam, or check that the built-in camera isn't disabled."
fi
if system_profiler SPAudioDataType 2>/dev/null | grep -q "Input Channels"; then
  pass "Microphone found"
else
  fail "No microphone found" "Plug in a USB mic or webcam with a mic."
fi
info "Whether Chrome is allowed to use them shows up in the console (a yellow warning if not)."

# 3. Two displays
screens="$(list_screens)"
count="$(printf '%s\n' "$screens" | grep -c .)"
if [ "$count" -ge 2 ]; then
  pass "Two screens: projection goes to the one at $(printf '%s\n' "$screens" | awk '$5=="other"{print $1","$2" ("$3"x"$4")"; exit}')"
else
  fail "Only one screen found" \
       "Plug in the projector, then in System Settings → Displays choose Extended (not Mirror) and keep the iMac as the main display. Without it the face shows in TV mode."
fi

# 4. Outbound HTTPS (port 443) to the services HoloHead uses
for host in 0.peerjs.com cdnjs.cloudflare.com apiprofe-com.github.io; do
  if curl -s -o /dev/null -m 8 "https://$host/"; then
    pass "Outbound 443 to $host"
  else
    fail "Can't reach $host on port 443" "The network is blocking it. Try Ethernet or another network, or ask IT to allow it."
  fi
done

# 5. Settings
if [ -n "$ROOM" ]; then pass "Room code set ($ROOM)"; else fail "No room code" "Run install.sh, or add ROOM=yourcode to $HH_DIR/config.local."; fi
if [ -n "$TURN_URLS" ]; then info "Relay (TURN) configured."; else info "No relay (TURN) configured. Fine unless calls fail on campus Wi-Fi."; fi

# 6. Network type
iface="$(route get default 2>/dev/null | awk '/interface:/ {print $2}')"
if networksetup -listallhardwareports 2>/dev/null | grep -A1 "Hardware Port: Ethernet" | grep -q "Device: $iface"; then
  pass "Using wired Ethernet ($iface)"
else
  info "Not on Ethernet ($iface). Wi-Fi works, but Ethernet is more reliable."
fi

echo
if [ "$fails" -eq 0 ]; then echo "All checks passed."; else echo "$fails check(s) failed. See the notes above."; fi
exit "$fails"
