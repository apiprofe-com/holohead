# HoloHead how-to guide

HoloHead lets you hold **live office hours from your classroom**. A computer in the room shows
the class camera on a TV. Students join from a link on their phone or laptop, with nothing to
install: they watch and listen, chat, and raise a hand to speak. You choose who talks.

It can also project your live face onto a foam head (the "disembodied head"). That part is
optional and covered at the end.

- [1. What students and you see](#1-what-students-and-you-see)
- [2. Requirements](#2-requirements)
- [3. One-time setup (about 30 minutes)](#3-one-time-setup-about-30-minutes)
- [4. Running office hours](#4-running-office-hours)
- [5. Before-class checklist](#5-before-class-checklist)
- [6. Optional: the foam head](#6-optional-the-foam-head)
- [7. Troubleshooting](#7-troubleshooting)

---

## 1. What students and you see

```
  Classroom Mac ──── TV (class camera, or your shared screen)
       │
       ├── Console window (only you): class mode switch, student list, queue, chat, share screen
       │
       └── Student link ──── up to 5 students, each on their own phone or laptop
                              • watch and hear the classroom
                              • chat
                              • ✋ raise a hand; when you give them the floor, their mic and
                                camera turn on and everyone hears them
```

- **Students** see the classroom picture, a chat panel, a **Raise hand** button and their place
  in line. Their camera and mic are **off** until it's their turn.
- **You** see the console: who's here, who's waiting, **Give floor / Next / End turn / Remove**,
  chat, and **Share screen**.
- **The TV** shows the classroom camera. While you share your screen, it shows your screen.
- **Nothing is recorded.** Video goes straight from the classroom Mac to each student.

## 2. Requirements

**Hardware**
- A **Mac** with a camera and mic. A built-in iMac camera is fine, or a USB webcam. The launcher
  (which starts everything automatically) is Mac-only. On Windows or a Chromebook you can still
  open the pages in Chrome by hand (see [7](#7-troubleshooting)).
- A **TV or second screen** (optional): HDMI, set to **Extended**, not Mirror.
- **Speakers**, so the room hears students. The built-in ones work.
- A **wired Ethernet** connection is best. Wi-Fi works.

**Software and accounts (all free)**
- **Google Chrome.** It doesn't need to be in Applications: running it from your own Documents
  folder works without admin rights.
- A **GitHub account**, which hosts your copy of the web pages.
- A **Cloudflare account**, for the relay that gets video through strict school and cellular
  networks. It includes 1,000 GB a month free, far more than office hours use. Check
  Cloudflare's current pricing if you're worried.

**Network**
- Only outgoing HTTPS (port 443) is needed. Nothing has to be opened on the school network.

**Permissions**
- **No admin password** is needed. Everything installs inside your own home folder.
- If your school's device management (for example Jamf) blocks Chrome outside Applications, ask
  IT to allow it. The preflight check tells you.
- macOS may ask once to let Chrome use the camera and microphone. Click **Allow**.

**Limits and privacy**
- **5 students at a time.** The classroom Mac sends video to each one directly.
- **Anyone with the student link can watch** while class mode is on. Share it only through your
  LMS (Canvas, Google Classroom…), and point the camera at the front of the room rather than at
  students. Check your school's policy on streaming classrooms.
- Students type any name they like. **Remove** takes someone out of the session.

## 3. One-time setup (about 30 minutes)

### Step 1: Make your own copy
1. On the HoloHead GitHub page, click **Use this template → Create a new repository**.
2. Give it a name (for example `holohead`) and choose **Public**. Free GitHub Pages needs a public
   repository. Your private codes are never stored in it.
3. Click **Create repository**.

### Step 2: Turn on the web pages
1. In your new repository: **Settings → Pages**.
2. Under **Build and deployment**, set **Source: Deploy from a branch**, **Branch: main**, and
   **folder: /docs**. Click **Save**.
3. After a minute, your pages are at `https://YOUR-GITHUB-NAME.github.io/REPO-NAME/`. Write this
   down.

### Step 3: Create the relay key (Cloudflare)
1. Log in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. In the sidebar, choose **Realtime**. Under **TURN Server**, click **Create**, give it a name,
   and click **Create**.
3. Copy the **Turn Token ID** and the **API Token**. You'll need them in the next step. Keep them
   private.

### Step 4: Install on the classroom Mac
1. Download your copy. Either:
   - **Terminal:** `git clone https://github.com/YOUR-GITHUB-NAME/REPO-NAME.git ~/HoloHead-src`
   - or **Code → Download ZIP** on GitHub, then unzip it into your home folder.
2. Put **Chrome** somewhere it can run: Applications, or drag `Google Chrome.app` into your
   **Documents** folder.
3. Open **Terminal** and run the installer, using the folder from step 1:
   ```
   ~/HoloHead-src/launcher/install.sh
   ```
   The installer:
   - asks for **your name as students will see it** (for example "Ms. Rivera")
   - works out your pages address, or asks for it after a ZIP download
   - creates two codes:
     - a private **room code** (for the console and the phone)
     - a public **class code** (for the student link)
   - installs everything into `~/Desktop/HoloHead`
   - builds **HoloHead.app** and adds it to your Login Items
   - runs the preflight check
4. At the end it prints a line like:
   `For the relay, the HOLOHEAD_ROOMS secret on GitHub should be: abcd2345,wxyz6789`.
   Copy those codes.

If macOS asks to let Terminal control "System Events", click **OK** (that's for the Login Item).

### Step 5: Give GitHub the relay key and your codes
1. In your repository: **Settings → Secrets and variables → Actions → New repository secret**.
   Add these three:

   | Name | Value |
   |---|---|
   | `CF_TURN_KEY_ID` | the Turn Token ID from step 3 |
   | `CF_TURN_API_TOKEN` | the API Token from step 3 |
   | `HOLOHEAD_ROOMS` | the two codes from step 4, with a comma between them and no spaces |

2. Go to **Actions**. If GitHub asks, click **I understand my workflows, go ahead and enable
   them**.
3. Click **Refresh relay credentials → Run workflow**. After it shows a green check, the relay
   password refreshes itself every 12 hours.

### Step 6: Check it
In Terminal:
```
~/Desktop/HoloHead/preflight.sh
```
Every line should say **PASS** or **INFO**. Each FAIL comes with a sentence telling you how to fix
it. At the end, the check prints your **student link**.

Then double-click `~/Desktop/HoloHead/HoloHead.app`. The TV shows a soft glow and the coral reef
video, and the **console** opens on the Mac screen.

## 4. Running office hours

1. **Start:** in the console, click **Class mode**. The TV switches to the classroom camera, and
   the Mac's camera and mic turn on.
2. **Share the link:** click **Copy** next to the student link in the console, and post it in your
   LMS. The link is the same every time, so you can post it once.
3. **Students join:** they type a name and click **Join**, then see and hear the classroom.
4. **Taking turns:**
   - Students click **✋ Raise hand**. In the console they appear in order (✋ 1, ✋ 2…).
   - Click **Give floor** next to a name, or **Next in line**. That student's mic and camera turn
     on: their voice comes from the classroom speakers, everyone else hears and sees them, and
     you see their camera in the console.
   - Click **End turn** (or the student clicks **Done**) to turn them off.
5. **Chat:** type in the console's chat box. Students see your messages under your name.
6. **Share your screen:** click **Share screen** and choose the screen or window. The TV and the
   students switch to it. Click **Stop sharing** to go back to the camera.
7. **End:** click **Class mode** again. Students see "Office hours just ended", and the camera
   turns off.

Good to know:
- Students can keep the page open. It joins by itself the next time you turn on class mode.
- If the Mac restarts, class mode starts **off**, so the camera can't be left on by accident.
- **Remove** takes a student out, but they can rejoin with the link. To lock everyone out, make a
  new class code: change `CLASS` in `~/Desktop/HoloHead/config.local`, update the
  `HOLOHEAD_ROOMS` secret, run the relay workflow, and restart HoloHead.

## 5. Before-class checklist

Print this, or keep it next to the Mac.

- [ ] Mac is on and logged in. The TV is on, set to the right HDMI input, and its sleep timer is
      off.
- [ ] The console says **Console link: connected** and **Projection: ready**.
- [ ] Optional, after changes: `~/Desktop/HoloHead/preflight.sh` shows no FAIL.
- [ ] Camera points at the front of the room or the board, not at students.
- [ ] Turn on **Class mode**. The TV shows the camera, and the microphone bar in the console moves
      when you talk.
- [ ] Test the student link on **your own phone with Wi-Fi off** (cellular): picture and sound
      arrive.
- [ ] On that phone, raise a hand and give yourself the floor. You hear yourself from the room
      speakers. Then end the turn.
- [ ] Speaker volume is comfortable, and there's no loud echo.
- [ ] If you'll share slides, open them before class and try **Share screen** once.
- [ ] The student link is posted in your LMS.
- [ ] When you're done: turn **Class mode** off.

## 6. Optional: the foam head

The original use: your live face, sent from your phone, projected onto a foam head at an event.
People walk up, talk to the head, and you answer live.

**Extra hardware (about $80–150):** a foam mannequin head, lightly sanded and sprayed matte
white or light gray; a mini projector and the right HDMI adapter; a stand for the head; a dim
spot near an outlet. Mount the projector in front of the head, slightly above it, angled down.

**Your phone:** open the phone link printed by the installer (`sender.html?room=…`, keep it
private) in Safari, then Share → **Add to Home Screen**. Tap **Start** and allow the camera and
mic. Use a phone stand, even light from the front and a plain dark background, and keep your head
fairly still.

**Calibrate** (in the console):
1. Press **Test pattern**. A green grid and a yellow oval appear on the projector.
2. **Line up with the foam head:** use Size, Left/right and Up/down until the oval sits on the
   foam face. Use Rotate if the head is tilted. Use the **corner warp** sliders if the projector
   is off to the side.
3. Call in from the phone. Under **Face inside the oval**, zoom and move your face until your eyes
   and mouth sit on the foam's.
4. Set the **Oval mask** to the size of the face, with a **Soft edge**. Under **Picture**, lower the
   brightness, since foam is bright, and raise the contrast a little.
5. Press **Test pattern** again to hide it. Everything saves automatically.

**Screen layout:** choose **Split** (the face plus a side video, for example a YouTube livestream)
or **Face only**, and what shows while nobody is calling: a glow, the side video, black, or
"Waiting…". **Black-out** blanks the projector instantly. Phone calls wait while class mode is on.

## 7. Troubleshooting

- **The TV is blank, but everything says it's running:** the TV went to sleep or changed input.
  Turn off the TV's "auto power off", "sleep timer" or "eco" setting.
- **A student is stuck on "Office hours are closed":** class mode is off, or the projection isn't
  ready (check the console). It joins by itself within a few seconds of class mode turning on.
- **A student connects on Wi-Fi but not on cellular or school Wi-Fi:** the relay isn't set up for
  the class code.
  - Run `preflight.sh`. Check that `HOLOHEAD_ROOMS` contains both codes, then rerun the relay
    workflow.
  - "Relay password expired" means the workflow is failing: check the two `CF_TURN_` secrets.
- **"Tap to turn on sound" on a student's screen:** their browser blocked sound until a tap.
  Tapping once fixes it.
- **No sound in the room when a student speaks:** check the Mac's volume and output device. If the
  projection was opened by hand (not through HoloHead.app), click once on the TV screen.
- **Yellow "can't use the camera" warning in the console:** go to System Settings → Privacy &
  Security → Camera (and Microphone) and turn on Chrome. If that needs an admin password, ask IT.
- **The college blocks Chrome:** ask IT to allow it. As a fallback, use Safari: open the
  projection page, drag it onto the TV, and press Ctrl-Cmd-F. Then open the console in a second
  window.
- **The projection lands on the wrong screen:** run `preflight.sh` to see the detected position,
  and set `PROJ_POS` in `config.local` if it's wrong.
- **Not on a Mac:** open `YOUR-PAGES/projection.html?room=ROOM&class=CLASS&teacher=YOUR%20NAME`
  in Chrome, make it fullscreen on the TV, and open `YOUR-PAGES/console.html?room=ROOM` in another
  window. Click once on the projection page so it may play sound.
- **Stop everything:** `~/Desktop/HoloHead/stop.sh`. Quitting the TV window alone doesn't work,
  because the launcher reopens it on purpose. To remove everything:
  `~/Desktop/HoloHead/uninstall.sh`.

Settings live in `~/Desktop/HoloHead/config.local`:
- `TEACHER`: your name
- `ROOM`: private code
- `CLASS`: public code
- `BASE_URL`: your pages
- `VIEWER`: your face on the Mac screen too: `window`, `fullscreen` or `off`
- `PROJ_POS`: the projector position

After editing, run `stop.sh` and start HoloHead.app again.
