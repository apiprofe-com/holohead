# HoloHead

**Live office hours from your classroom, free, with nothing for students to install.** A Mac in
the room shows the class camera on a TV. Students open a link to watch and listen, chat, and
raise a hand. You choose who speaks: their mic and camera turn on, and the room and the other
students hear them. You can also share your screen. HoloHead can also project your live face onto
a foam head.

**👉 Start here: [GUIDE.md](GUIDE.md)** for the requirements, the one-time setup (about 30
minutes), how to run office hours, a before-class checklist, and troubleshooting.

- Runs in Chrome. No admin password, no installs outside your home folder, no paid services.
- Up to 5 students at a time. Nothing is recorded.
- Make your own copy with **Use this template**; your pages and relay are your own.

## The pages

All pages live in `docs/` and are served by GitHub Pages.

| Page | Who | What |
|---|---|---|
| `class.html?c=CLASS` | students | Office hours: the class video, chat, raise hand, speak when given the floor |
| `console.html?room=ROOM` | you, on the Mac | Class mode, the student queue, chat, screen share, projection calibration |
| `projection.html?room=ROOM&class=CLASS` | the TV or projector | The class camera in class mode, otherwise the face (or a glow and side video) |
| `sender.html?room=ROOM` | your phone | Foam head: sends your face and voice to the head |
| `viewer.html?room=ROOM` | the Mac screen | Foam head: your face, for people standing at the Mac |

There are two codes:
- **ROOM** is private. It controls the head and the console.
- **CLASS** is public, but only for the student link, so students never get the room code.

The launcher (`launcher/`) keeps the Mac awake and opens the pages on the right screens. It
reopens them if they close, and it starts at login.

## How it connects

Browsers talk to each other directly (WebRTC). The free PeerJS service introduces them by code.
In class mode, the classroom Mac is the hub: each student connects only to it. Everything is
**outgoing** on port 443, so nothing has to be opened on the network.

Cellular and school networks often block the direct route, so there's a built-in **relay**
(Cloudflare TURN):
- Its passwords last at most two days. The GitHub Action `.github/workflows/turn.yml` fetches new
  ones every 12 hours.
- It encrypts them once per code listed in the `HOLOHEAD_ROOMS` secret and publishes them as
  `docs/turn.json`. Pages unlock it with their code, so links work with nothing to type.

Repo secrets: `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`, `HOLOHEAD_ROOMS` (room and class codes,
separated by commas). After changing a code, update the secret and run the workflow.

## Development

Static files, no build step. To test locally:
```
cd docs && python3 -m http.server 8765
```
Then open `http://localhost:8765/`. Localhost counts as secure, so the camera works.
`sender.html?auto=1` skips the Start button.

When you change anything in `docs/js` or `docs/css`, bump the `?v=N` on every script and style
link in `docs/*.html`. GitHub Pages lets browsers keep files for 10 minutes.

## License

[CC BY-NC 4.0](LICENSE): free to use, share and adapt, with credit and not for commercial use.
Created by Lucas ([apiprofe-com](https://github.com/apiprofe-com)).
