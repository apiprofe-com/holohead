#!/bin/bash
# Remove HoloHead: stops it, removes the Login Item, and deletes the HoloHead folder
# (after asking). Chrome itself is kept unless it lives inside the HoloHead folder.
HH_DIR="$(cd "$(dirname "$0")" && pwd)"

"$HH_DIR/stop.sh" 2>/dev/null

osascript -e 'tell application "System Events" to if exists login item "HoloHead" then delete login item "HoloHead"' >/dev/null 2>&1 \
  && echo "Removed the HoloHead Login Item." \
  || echo "Couldn't remove the Login Item automatically: System Settings → General → Login Items → select HoloHead → −"

if [ -d "$HH_DIR/Google Chrome.app" ]; then
  echo "Note: Google Chrome is inside this folder and will be deleted with it."
fi
read -r -p "Delete the folder $HH_DIR and everything in it? Type yes to confirm: " answer
if [ "$answer" = "yes" ]; then
  rm -rf "$HH_DIR"
  echo "HoloHead removed."
else
  echo "Folder kept."
fi
