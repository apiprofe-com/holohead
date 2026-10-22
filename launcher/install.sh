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
echo "  ${BASE_URL:-https://apiprofe-com.github.io/holohead}/sender.html?room=$ROOM"
echo "Start HoloHead now: double-click $DEST/HoloHead.app"
