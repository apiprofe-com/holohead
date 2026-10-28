#!/bin/bash
# Install HoloHead for this user, without admin rights:
#   - copies the launcher into ~/Desktop/HoloHead (or the folder you pass as the first argument)
#   - creates config.local with a new room code (kept if it already exists)
#   - builds HoloHead.app (double-click to start) and adds it to your Login Items
#   - runs the preflight check
set -u
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-$HOME/Desktop/HoloHead}"

explain() { echo; echo "Couldn't $1."; echo "$2"; exit 1; }
. "$SRC/lib.sh"

case "$DEST" in
  /Applications*|/Library*|/System*|/usr*) explain "use $DEST" "That's a system folder and needs an admin. Use a folder inside your home folder instead." ;;
esac

mkdir -p "$DEST" || explain "create $DEST" "Pick a folder you own, e.g. ./install.sh ~/Documents/HoloHead"
for f in lib.sh holohead.sh stop.sh preflight.sh uninstall.sh config.example; do
  cp "$SRC/$f" "$DEST/$f" || explain "copy $f" "Check that $DEST is writable."
done
chmod +x "$DEST"/*.sh

if [ ! -f "$DEST/config.local" ]; then
  room="$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' < /dev/urandom | head -c 8)"
  sed "s/^ROOM=.*/ROOM=\"$room\"/" "$DEST/config.example" > "$DEST/config.local"
  echo "New room code: $room"
fi
# Set KEY="value" in config.local (replacing an empty or old line).
set_config() {
  grep -v "^$1=" "$DEST/config.local" > "$DEST/config.local.tmp" && mv "$DEST/config.local.tmp" "$DEST/config.local"
  printf '%s="%s"\n' "$1" "$2" >> "$DEST/config.local"
}
is_set() { grep -q "^$1=\"..*\"" "$DEST/config.local"; }

# Web address of your copy's pages, worked out from where you downloaded it (git clone).
if ! is_set BASE_URL; then
  if url="$(pages_url_from_git "$SRC/..")"; then
    set_config BASE_URL "$url"
    echo "Pages address: $url"
  else
    echo "Couldn't work out your pages address (that happens with a ZIP download)."
    printf 'Type it here, e.g. https://yourname.github.io/holohead : '
    read -r url
    url="${url%/}"
    if [ -n "$url" ]; then set_config BASE_URL "$url"
    else echo "Skipped. Put BASE_URL=\"https://yourname.github.io/holohead\" in $DEST/config.local before starting."; fi
  fi
fi

# Code for the office hours student link: public, and never the same as the room code.
if ! is_set CLASS; then
  class="$(LC_ALL=C tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' < /dev/urandom | head -c 8)"
  set_config CLASS "$class"
  echo "New class code: $class"
fi

if ! is_set TEACHER; then
  printf 'Your name as students will see it (e.g. Ms. Rivera), or Enter to skip: '
  read -r teacher
  teacher="$(printf '%s' "$teacher" | tr -d '"$`\\')"
  [ -n "$teacher" ] && set_config TEACHER "$teacher"
fi
. "$DEST/config.local"

# Double-clickable app that starts the launcher in the background.
rm -rf "$DEST/HoloHead.app"
osacompile -o "$DEST/HoloHead.app" -e '
set appPath to POSIX path of (path to me)
set folderPath to do shell script "dirname " & quoted form of appPath
do shell script "nohup /bin/bash " & quoted form of (folderPath & "/holohead.sh") & " >/dev/null 2>&1 &"
' || explain "build HoloHead.app" "osacompile failed. You can still start HoloHead by running holohead.sh."
echo "Built $DEST/HoloHead.app"

# Start at login (user-level Login Item; macOS may ask once to let Terminal control System Events).
if osascript -e "tell application \"System Events\"
  if exists login item \"HoloHead\" then delete login item \"HoloHead\"
  make login item at end with properties {path:\"$DEST/HoloHead.app\", hidden:true}
end tell" >/dev/null 2>&1; then
  echo "Added HoloHead to your Login Items: it starts when you log in."
else
  echo
  echo "Couldn't add the Login Item automatically (macOS didn't allow it)."
  echo "Do it by hand: System Settings → General → Login Items → + → choose $DEST/HoloHead.app"
fi

echo
"$DEST/preflight.sh"
echo
echo "Phone link (open in Safari on the iPhone, then Add to Home Screen):"
echo "  $BASE_URL/sender.html?room=$ROOM"
[ -n "${CLASS:-}" ] && echo "Office hours link for students: $BASE_URL/class.html?c=$CLASS"
echo
echo "For the relay, the HOLOHEAD_ROOMS secret on GitHub should be: $ROOM,$CLASS"
echo "Start HoloHead now: double-click $DEST/HoloHead.app"
