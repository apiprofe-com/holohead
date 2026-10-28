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
pages_host="$(echo "$BASE_URL" | sed -E 's#^https?://([^/]+).*#\1#')"
for host in 0.peerjs.com cdnjs.cloudflare.com $pages_host; do
  if curl -s -o /dev/null -m 8 "https://$host/"; then
    pass "Outbound 443 to $host"
  else
    fail "Can't reach $host on port 443" "The network is blocking it. Try Ethernet or another network, or ask IT to allow it."
  fi
done

# 5. Settings
if [ -n "$ROOM" ]; then pass "Room code set ($ROOM)"; else fail "No room code" "Run install.sh, or add ROOM=yourcode to $HH_DIR/config.local."; fi
if [ -z "$CLASS" ]; then
  fail "No class code (office hours)" "Run install.sh again, or add CLASS=\"somecode\" to $HH_DIR/config.local."
elif [ "$CLASS" = "$ROOM" ]; then
  fail "The class code is the same as the room code" "Students would get control of the head. Pick a different CLASS in $HH_DIR/config.local."
else
  pass "Class code set ($CLASS)"
fi
if [ -n "$TEACHER" ]; then pass "Teacher name: $TEACHER"; else info "No TEACHER name set; students see \"Teacher\". Add TEACHER=\"Ms. Rivera\" to config.local."; fi

# 6. Your web pages are published (GitHub Pages)
if [ -z "$BASE_URL" ]; then
  fail "No web address (BASE_URL)" "Run install.sh, or add BASE_URL=\"https://yourname.github.io/holohead\" to $HH_DIR/config.local."
else
  for page in projection.html console.html class.html; do
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$BASE_URL/$page")"
    if [ "$code" = "200" ]; then pass "Page online: $BASE_URL/$page"
    else fail "Page not found: $BASE_URL/$page (HTTP $code)" "Turn on GitHub Pages for your copy (Settings → Pages → Branch: main, folder /docs) and wait a minute."; fi
  done
fi

# 7. Relay (TURN), for students and phones on strict networks
if [ -n "$TURN_URLS" ]; then
  info "Using your own relay from config.local."
elif [ -n "$BASE_URL" ] && relay="$(curl -s -m 10 "$BASE_URL/turn.json")" && echo "$relay" | grep -q '"expires"'; then
  expires="$(echo "$relay" | sed -nE 's/.*"expires": *"([^"]+)".*/\1/p' | head -1)"
  entries="$(echo "$relay" | grep -c '"salt"')"
  exp_s="$(date -j -u -f '%Y-%m-%dT%H:%M:%S' "${expires%%.*}" +%s 2>/dev/null || echo 0)"
  if [ "$exp_s" -gt "$(date +%s)" ]; then
    pass "Relay password current (valid until $expires UTC)"
  else
    fail "Relay password expired ($expires)" "On GitHub: Actions → Refresh relay credentials → Run workflow. Check the CF_TURN_* secrets if it fails."
  fi
  if [ "$entries" -lt 2 ]; then
    info "The relay file is unlocked by $entries code(s). Both the room and class codes should be in the HOLOHEAD_ROOMS secret: $ROOM,$CLASS"
  else
    info "The relay file is unlocked by $entries codes (should include $ROOM and $CLASS; this can't be checked from here)."
  fi
else
  info "No relay set up yet. Most calls still connect; some cellular and school networks need it (see GUIDE.md)."
fi

# 8. Network type
iface="$(route get default 2>/dev/null | awk '/interface:/ {print $2}')"
if networksetup -listallhardwareports 2>/dev/null | grep -A1 "Hardware Port: Ethernet" | grep -q "Device: $iface"; then
  pass "Using wired Ethernet ($iface)"
else
  info "Not on Ethernet ($iface). Wi-Fi works, but Ethernet is more reliable."
fi

echo
if [ -n "$BASE_URL" ] && [ -n "$CLASS" ]; then
  echo "Student link (office hours): $BASE_URL/class.html?c=$CLASS"
  echo "Phone link (keep private):   $BASE_URL/sender.html?room=$ROOM"
  echo
fi
if [ "$fails" -eq 0 ]; then echo "All checks passed."; else echo "$fails check(s) failed. See the notes above."; fi
exit "$fails"
