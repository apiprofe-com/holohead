#!/bin/bash
# Shared helpers for the HoloHead launcher scripts. Sourced, not run directly.
# Never uses sudo: everything here works for a standard (non-admin) user.

HH_DIR="${HH_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

# Defaults; override any of these in config.local (same folder).
BASE_URL="https://apiprofe-com.github.io/holohead"
ROOM=""
CHROME_APP=""        # full path to "Google Chrome.app" if it's somewhere unusual
PROJ_POS=""          # "x,y" of the projector screen, if auto-detect gets it wrong
TURN_URLS=""         # optional relay, e.g. "turn:host:80 turns:host:443?transport=tcp"
TURN_USER=""
TURN_PASS=""
FORCE_RELAY=0
VIEWER="window"      # Lucas on the iMac screen too: window | fullscreen | off
DEBUG_PORT=""        # e.g. 9333 to let tools inspect the projection window (local only)

[ -f "$HH_DIR/config.local" ] && . "$HH_DIR/config.local"

# Print the path of the first Chrome found, in the order the plan asks for.
find_chrome() {
  local c
  for c in "$CHROME_APP" \
           "$HH_DIR/Google Chrome.app" \
           "$HOME/Documents/Google Chrome.app" \
           "$HOME/Applications/Google Chrome.app" \
           "/Applications/Google Chrome.app"; do
    if [ -n "$c" ] && [ -x "$c/Contents/MacOS/Google Chrome" ]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

chrome_missing_help() {
  cat <<'EOF'
Google Chrome wasn't found.
  1. Download Chrome from https://www.google.com/chrome/ (the .dmg file).
  2. Open the .dmg and drag "Google Chrome" into your HoloHead folder
     (or your Documents folder). Don't drag it to Applications; that needs an admin.
  3. Double-click it once and choose Open, then run this again.
EOF
}

# One line per screen: "x y width height main|other", in Chrome's coordinates
# (top-left origin, measured from the main screen). Uses AppKit, no special permissions.
list_screens() {
  osascript -l JavaScript -e '
    ObjC.import("AppKit");
    var s = $.NSScreen.screens, out = [];
    var mainH = s.objectAtIndex(0).frame.size.height;
    for (var i = 0; i < s.count; i++) {
      var f = s.objectAtIndex(i).frame;
      out.push([f.origin.x, mainH - (f.origin.y + f.size.height), f.size.width, f.size.height,
                i === 0 ? "main" : "other"].join(" "));
    }
    out.join("\n");' 2>/dev/null
}

# Build the page address with room and relay settings.
page_url() {
  local page="$1" extra="$2" q
  q="room=$ROOM"
  if [ -n "$TURN_URLS" ]; then
    q="$q&turn=$(urlencode "$TURN_URLS")&turnUser=$(urlencode "$TURN_USER")&turnPass=$(urlencode "$TURN_PASS")"
  fi
  [ "$FORCE_RELAY" = "1" ] && q="$q&relay=1"
  [ -n "$extra" ] && q="$q&$extra"
  echo "$BASE_URL/$page.html?$q"
}

urlencode() {
  osascript -l JavaScript -e 'function run(argv) { return encodeURIComponent(argv[0]); }' "$1"
}
