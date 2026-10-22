# HoloHead

Your live face on a foam head. You call in from your iPhone; an iMac at the venue projects your
face onto the head and sends the visitors' video and sound back to you. It runs in the browser,
installs nothing system-wide, and never needs an admin password.

- **Pages:** https://apiprofe-com.github.io/holohead/
- **Phone:** `sender.html?room=CODE`. Your camera and mic go to the head, and you see the visitors.
- **Projector:** `projection.html?room=CODE`. Only your face on black. In split mode the
  screen is shared with a side video (the Coral City Camera livestream by default).
- **iMac screen, for people:** `viewer.html?room=CODE`. Lucas's face, big, like a video call, so
  students standing at the iMac (where the camera and mic are) see him too. It shows the side video
  while he's away. Double-click for full screen. Set `VIEWER` in `config.local` to `window`,
  `fullscreen` or `off`.
- **iMac screen, for you:** `console.html?room=CODE`. Status, camera preview, and every calibration
  control. It also works from a laptop or phone standing next to the head.

## How it connects

The phone and iMac talk to each other directly (WebRTC). The free PeerJS service introduces them
using the room code. Everything is **outgoing** on normal web ports (443), so nothing has to be
opened on the network.

Cellular and campus networks usually block the direct route. That's why there's a built-in
**relay**, Cloudflare's TURN service (free up to a large monthly allowance):

- Cloudflare's relay passwords last at most two days. The GitHub Action
  `.github/workflows/turn.yml` fetches new ones every 12 hours.
- It encrypts them with each room code and publishes them as `docs/turn.json`.
- The pages download that file and unlock it with their room code, so the plain phone link keeps
  working with nothing to type.

Repo secrets: `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`, and `HOLOHEAD_ROOMS`.
- `HOLOHEAD_ROOMS` is a comma-separated list of the room codes allowed to use the relay. **When
  you change the room code, update this secret** and run the workflow (Actions → Refresh relay
  credentials → Run workflow).
- To use a different relay, enter it on the home page (phone) or in `config.local` (iMac).

## Set up the iMac (once)

1. **Chrome:** it must open from your own folders. Here it already runs from `~/Documents`.
   Elsewhere: download the Chrome .dmg and drag Chrome into `~/Desktop/HoloHead` (not Applications).
2. **Screens:** plug in the projector. In **System Settings → Displays**, choose **Extended**
   (not Mirror) and keep the iMac as the **main display**, so the menu bar stays off the projector.
3. **Ethernet** if there's a jack. It's far more reliable than Wi-Fi.
4. **Install:** in Terminal, run
   ```
   ~/Scripts/disemhead/launcher/install.sh
   ```
   This copies the launcher to `~/Desktop/HoloHead`, creates a room code, builds `HoloHead.app`,
   adds it to Login Items, runs the preflight check, and prints the phone link.
   - If macOS asks to let Terminal control "System Events", click **OK** (it's for the
     Login Item).
   - If it can't add the Login Item, add `HoloHead.app` by hand: System Settings → General
     → Login Items → +.
5. **Start:** double-click `~/Desktop/HoloHead/HoloHead.app`. The projection goes fullscreen on
   the projector and the console opens on the iMac screen. The first time, if macOS asks whether
   Chrome may use the camera and microphone, click **Allow**.

To stop it, run `~/Desktop/HoloHead/stop.sh`. Quitting the projection window alone doesn't work:
the launcher reopens it on purpose.

### What the launcher does

- Keeps the display awake (`caffeinate`, built into macOS).
- Opens two separate Chrome windows with their own settings, so your normal Chrome isn't affected:
  - the **projection**, fullscreen on the second screen, which answers calls by itself
  - the **console**, on the iMac screen
- Reopens the projection if it closes.
- If only one screen is connected, it shows the face in **TV mode** on the main screen, and the
  console shows a warning.

`config.local` in the HoloHead folder holds the room code, an optional relay, and overrides for the
Chrome location or projector position.

## Set up the phone

1. Open the phone link (printed by the installer) in **Safari**. Then Share → **Add to Home
   Screen**.
2. Tap **Start** and allow the camera and microphone.
3. Put your face inside the yellow oval. Tap your small picture, or **Frame face**, to see it
   full screen while you line up.
4. Use a phone stand, even light from the front, and a plain dark background. Keep your head
   fairly still.

**Safari says the camera is blocked:** go to Settings → Apps → Safari → Camera (and Microphone) and
choose **Ask** or **Allow**, then reload. Make sure the address starts with `https://`. Private
Browsing tabs sometimes forget the permission.

## Calibrate the face onto the foam head

1. In the console, press **Test pattern**. A green grid and a yellow oval appear on the projector.
2. **Line up with the foam head:**
   - Use Size, Left/right and Up/down until the yellow oval sits on the foam face.
   - Use Rotate if the head is tilted.
   - If the projector is off to the side or angled, use the **corner warp** sliders until
     the grid looks square on the head.
3. Call in from the phone. Under **Face inside the oval**, use Zoom and position so your eyes
   and mouth sit where the foam's eyes and mouth are.
4. **Oval mask:** set its width and height to the size of the foam face, and **Soft edge** so
   the edge fades out gently.
5. **Picture:** foam is bright, so lower the brightness until it stops looking washed out.
   Raise the contrast slightly.
6. Press **Test pattern** again to hide it.

Everything saves automatically on the iMac. Double-click a slider to reset just that one.
**Reset calibration** puts everything back except the layout.

### Split screen

Under **Screen layout**:
- Choose **Split** or **Face only**.
- Choose which side the face goes on and how wide it is.
- Choose what plays in the other half. Paste any YouTube link; it plays muted.
- **While Lucas is offline:** the default is **screensaver**, where the side video fills the
  whole screen until you call in. The other choices are a soft glow, black, or "Waiting for
  Lucas…".

**Black-out** blanks the whole projector instantly.

## Network test checklist

Watch the console's **Route** line: "direct" is best, "TURN relay" means the relay is in use.

| Test | How | Expect |
|---|---|---|
| Same network | Phone on the same Wi-Fi as the iMac | Live, direct |
| Cellular to campus | Turn off the phone's Wi-Fi | Live, usually direct |
| UDP blocked | On the phone's home page, tick **Force relay** (needs TURN set) | Live, TURN relay |
| Network drop | Unplug the iMac's Ethernet for 20 s, then plug it back in | The head goes idle, then reconnects by itself |
| Projector unplugged | Unplug HDMI, then run stop.sh and start HoloHead.app again | TV mode on the iMac screen, plus a warning |
| Login | Log out and back in | Everything starts by itself |

## Troubleshooting

- **Head says it's offline / the phone keeps retrying:**
  - Check the room code matches on both ends.
  - Check the console says "Projection: ready".
  - Press **Reconnect call**.
- **Connects but there's no picture on campus Wi-Fi:** UDP is probably blocked. Add a TURN relay
  (with a `turns:…:443?transport=tcp` address) on both the phone and the iMac.
- **No sound from the head:** if the projection was opened without the launcher, click once on
  the projector screen.
- **Yellow "can't use the iMac camera" warning:** macOS hasn't allowed Chrome to use the camera.
  Go to System Settings → Privacy & Security → Camera and turn Chrome on. If that asks for an
  admin password, the college has locked it; ask IT.
- **Projection lands on the wrong screen:**
  - Run `preflight.sh` to see the detected position.
  - If it's wrong, set `PROJ_POS` in `config.local`.
- **The college blocks Chrome:** use Safari instead.
  1. Open the projection page and drag its window onto the projector.
  2. Press Ctrl-Cmd-F for fullscreen.
  3. Open the console in a second Safari window.

  Keep a Zoom or Meet link ready as a last resort.

## Development

Static files in `docs/` (served by GitHub Pages), with no build step. To test locally:
```
cd docs && python3 -m http.server 8765
```
Then open `http://localhost:8765/`. Localhost counts as secure, so the camera works.
`sender.html?auto=1` skips the Start button.
