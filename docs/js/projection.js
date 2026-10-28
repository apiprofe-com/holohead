// Projection page: owns the call, shows the masked face, takes orders from the console.
(() => {
  const $ = id => document.getElementById(id);
  const room = HH.room();
  const forcedTv = HH.params.get('tv') === '1';
  const classCode = HH.classCode();
  let calib = HH.load(HH.KEYS.calib, HH.DEFAULT_CALIB);
  // Class mode never survives a reload or restart, so the classroom camera can't stay on overnight.
  calib.classMode = false;

  let peer = null;
  let activeCall = null;
  let localStream = null;
  let camError = '';
  let peerState = 'starting';
  let live = false;
  let lastStats = null;
  let micLevel = 0;
  const consoles = new Set();
  const feeds = new Map(); // viewer connection -> call forwarding the caller's video to it
  const retry = HH.backoff();

  // Class mode (office hours): students connect to a second peer id, made from the public class code.
  const MAX_STUDENTS = 5;
  const VIDEO_KBPS = 1200;
  let classOn = false;
  let classBusy = false;
  let classPeer = null;
  const classRetry = HH.backoff();
  const students = new Map(); // student peer id -> { id, name, conn, out (call sending the class to them) }
  let queue = [];             // student ids with a raised hand, in order
  let floor = null;           // id of the student who may speak
  let speakerCall = null;     // their call to us (mic + camera)
  let speakerStream = null;
  let speakerFeeds = [];      // calls forwarding the speaker's video to the other students and consoles
  let shareCall = null;       // the teacher's screen, sent from the console
  let shareStream = null;
  let mix = null;             // { ctx, dest, speakerSrc }: iMac mic + speaker, for everyone but the speaker
  const chat = [];

  if (!room) {
    showNotice('No room code. Open this page from the HoloHead home page, or add ?room=yourcode to the address.');
    return;
  }

  HH.keepAwake();
  if (HH.teacher()) $('idleText').textContent = `Waiting for ${HH.teacher()}…`;
  applyCalib();
  window.addEventListener('resize', applyCalib);
  startPeer();
  setInterval(sendStatus, 1000);
  // Relay passwords expire after two days; keep the ones used for incoming calls current.
  setInterval(async () => {
    const config = await HH.iceConfig();
    if (peer && !peer.destroyed) peer.options.config = config;
  }, 30 * 60 * 1000);

  // ---------- Layout and calibration ----------

  function applyCalib() {
    const c = calib;
    const tv = c.tv || forcedTv;
    document.body.classList.toggle('tv', tv);
    document.body.classList.toggle('test', !!c.test);
    document.body.classList.toggle('live', live);
    document.body.classList.toggle('class', classOn);
    syncClass();
    document.body.dataset.idle = c.idle;
    $('blackout').style.display = c.blackout ? 'block' : 'none';
    $('dot').style.display = c.showDot ? 'block' : 'none';

    // Split screen
    // Screensaver: while nobody is calling the side video fills the whole screen.
    const saver = !live && c.idle === 'side' && !!c.sideUrl && !c.test;
    const split = (c.layout === 'split' || saver) && c.sideUrl;
    const side = $('sidePane');
    side.style.display = split ? 'block' : 'none';
    $('facePane').style.display = saver ? 'none' : 'block';
    $('facePane').style.flexBasis = split ? `${c.faceWidth}%` : '100%';
    $('stage').style.flexDirection = c.faceSide === 'left' ? 'row' : 'row-reverse';
    HH.playVideo($('side'), split ? HH.toEmbedUrl(c.sideUrl) : '');

    const video = $('face');
    video.style.filter = `brightness(${c.brightness}) contrast(${c.contrast}) saturate(${c.saturate})`;

    if (tv) {
      $('warp').style.transform = 'none';
      $('xform').style.transform = 'none';
      $('masked').style.maskImage = $('masked').style.webkitMaskImage = 'none';
      video.style.transform = c.mirror ? 'scaleX(-1)' : 'none';
      return;
    }

    const pane = $('facePane').getBoundingClientRect();
    if (pane.width) $('warp').style.transform = quadTransform(pane.width, pane.height, c.warp);
    $('xform').style.transform =
      `translate(${c.x}%, ${c.y}%) rotate(${c.rotate}deg) scale(${c.scale}) scaleX(${c.mirror ? -1 : 1})`;
    video.style.transform = `translate(${c.faceX}%, ${c.faceY}%) scale(${c.zoom})`;

    const inner = Math.max(0, 100 - c.feather);
    const mask = `radial-gradient(ellipse ${c.maskW}% ${c.maskH}% at 50% 50%, #000 ${inner}%, transparent 100%)`;
    $('masked').style.maskImage = $('masked').style.webkitMaskImage = mask;
    const ellipse = $('oval').querySelector('ellipse');
    ellipse.setAttribute('rx', `${c.maskW}%`);
    ellipse.setAttribute('ry', `${c.maskH}%`);
  }

  // CSS matrix3d that maps the pane's rectangle onto the four dragged corners.
  function quadTransform(w, h, warp) {
    if (!warp.some(v => v)) return 'none';
    const src = [[0, 0], [w, 0], [w, h], [0, h]];
    const dst = src.map(([x, y], i) => [x + (warp[i * 2] / 100) * w, y + (warp[i * 2 + 1] / 100) * h]);
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const [p, q, r, s, t, uu, g, hh] = solve(A, b);
    return `matrix3d(${p},${s},0,${g},${q},${t},0,${hh},0,0,1,0,${r},${uu},0,1)`;
  }

  // Gaussian elimination with partial pivoting.
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      [M[col], M[pivot]] = [M[pivot], M[col]];
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }

  // ---------- Camera and mic of the iMac (so the caller can see visitors) ----------
  // Only on during a call, so the camera light is off while nobody is calling.

  async function startLocalMedia() {
    if (localStream) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      camError = '';
      watchMic(localStream);
    } catch (e) {
      camError = `${e.name}: ${e.message}`;
      localStream = null;
    }
  }

  function stopLocalMedia() {
    if (!localStream) return;
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    if (watchMic.stop) watchMic.stop();
    micLevel = 0;
  }

  function watchMic(stream) {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const timer = setInterval(() => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        micLevel = Math.max(peak / 128, micLevel * 0.8);
      }, 100);
      watchMic.stop = () => { clearInterval(timer); ctx.close().catch(() => {}); watchMic.stop = null; };
    } catch (e) { /* meter is optional */ }
  }

  // ---------- Peer connection ----------

  async function startPeer() {
    peerState = 'connecting';
    peer = new Peer(HH.headId(room), { config: await HH.iceConfig(), debug: 1 });

    peer.on('open', () => { peerState = 'ready'; retry.reset(); setDot(); });
    peer.on('call', call => {
      const role = call.metadata && call.metadata.role;
      if (role === 'share') return receiveShare(call);
      if (classOn || classBusy) { call.close(); return; } // the phone waits until class mode is off
      answer(call);
    });
    peer.on('connection', attachConsole);
    peer.on('disconnected', () => {
      peerState = 'connecting'; setDot();
      setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, retry.next());
    });
    peer.on('error', err => {
      // 'unavailable-id' happens when an old copy of this page is still registered; wait and retry.
      if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(err.type)) {
        restartPeer();
      }
    });
  }

  function restartPeer() {
    peerState = 'offline'; setDot();
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    setTimeout(startPeer, retry.next());
  }

  async function answer(call) {
    if (activeCall) { try { activeCall.close(); } catch (e) {} }
    if (live) setLive(false);
    activeCall = call;
    lastStats = null;
    await startLocalMedia();
    if (activeCall !== call) return;
    call.answer(localStream || undefined);
    // Only go live once media can actually flow: the stream event fires before the network path is up.
    const pc = call.peerConnection;
    let remote = null;
    const goLiveIfReady = () => {
      if (activeCall !== call || !remote || pc.connectionState !== 'connected' || live) return;
      const video = $('face');
      video.srcObject = remote;
      playWithSound(video);
      setLive(true);
    };
    call.on('stream', stream => { remote = stream; goLiveIfReady(); });
    const ended = () => { if (activeCall === call) { activeCall = null; setLive(false); if (!classOn && !classBusy) stopLocalMedia(); } };
    call.on('close', ended);
    call.on('error', ended);

    // Drop calls whose network path died, so the sender's reconnect gets a clean slate.
    let lostTimer = null;
    pc.addEventListener('connectionstatechange', () => {
      clearTimeout(lostTimer);
      goLiveIfReady();
      if (pc.connectionState === 'failed') call.close();
      if (pc.connectionState === 'disconnected') lostTimer = setTimeout(() => call.close(), 8000);
    });
  }

  function playWithSound(video) {
    video.muted = false;
    video.play().catch(() => {
      // Browser blocked sound without a click (only happens when opened without the launcher).
      video.muted = true;
      video.play().catch(() => {});
      const prompt = $('soundPrompt');
      prompt.hidden = false;
      document.addEventListener('click', () => { video.muted = false; video.play(); prompt.hidden = true; }, { once: true });
    });
  }

  function setLive(on) {
    live = on;
    if (!on) $('face').srcObject = null;
    applyCalib();
    setDot();
    if (on) consoles.forEach(feedViewer);
    else { feeds.forEach(f => { try { f.close(); } catch (e) {} }); feeds.clear(); }
  }

  // Viewers (viewer.html on the iMac screen) get a copy of the caller's video while they're live.
  function feedViewer(conn) {
    if (!live || !peer || feeds.has(conn) || !conn.open || !conn.metadata || conn.metadata.role !== 'viewer') return;
    const stream = $('face').srcObject;
    if (!stream) return;
    const feed = peer.call(conn.peer, stream, { metadata: { role: 'feed' } });
    feeds.set(conn, feed);
    const drop = () => { if (feeds.get(conn) === feed) feeds.delete(conn); };
    feed.on('close', drop);
    feed.on('error', drop);
  }

  function detachConsole(conn) {
    consoles.delete(conn);
    const feed = feeds.get(conn);
    if (feed) { feeds.delete(conn); try { feed.close(); } catch (e) {} }
  }

  function setDot() {
    $('dot').className = live ? 'live' : peerState === 'ready' ? 'ready' : 'down';
  }

  // ---------- Console link (any device, over a PeerJS data connection) ----------

  function attachConsole(conn) {
    conn.on('open', () => {
      consoles.add(conn);
      conn.send({ t: 'calib', calib });
      conn.send({ t: 'chatHistory', chat });
      feedViewer(conn);
      feedSpeaker(conn);
    });
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'calib') {
        calib = { ...HH.DEFAULT_CALIB, ...msg.calib };
        HH.save(HH.KEYS.calib, calib);
        applyCalib();
        consoles.forEach(c => { if (c !== conn && c.open) c.send({ t: 'calib', calib }); });
      }
      if (msg.t === 'cmd' && msg.cmd === 'reconnect') {
        if (activeCall) activeCall.close();
        restartPeer();
      }
      if (msg.t === 'cmd' && msg.cmd === 'reload') location.reload();
      if (msg.t === 'class') classCommand(msg);
      if (msg.t === 'chat') postChat(HH.teacher() || 'Teacher', msg.text, 'teacher');
    });
    conn.on('close', () => detachConsole(conn));
    conn.on('error', () => detachConsole(conn));
  }

  async function sendStatus() {
    if (activeCall && activeCall.peerConnection) {
      try { lastStats = await HH.callStats(activeCall.peerConnection, lastStats); } catch (e) {}
    }
    const status = {
      t: 'status', room, peer: peerState, live,
      class: {
        on: classOn, code: classCode, peer: classPeer && classPeer.open ? 'ready' : classOn ? 'connecting' : 'off',
        students: [...students.values()].map(s => ({ id: s.id, name: s.name })),
        queue, floor, sharing: !!shareStream, speakerLive: !!speakerStream, max: MAX_STUDENTS,
      },
      stats: live ? lastStats : null,
      mic: Math.round(micLevel * 100) / 100,
      cam: !camError, camError,
      extended: window.screen.isExtended,
      forcedTv,
      relayForced: HH.settings().forceRelay,
    };
    consoles.forEach(c => { if (c.open) c.send(status); });
  }

  // ---------- Class mode (office hours) ----------
  // The TV shows the iMac camera (or the teacher's shared screen) and students join from class.html.
  // This page is the hub: each student connects only to it. A student speaks only when the teacher gives
  // them the floor from the console.

  function syncClass() {
    const want = !!calib.classMode;
    if (classBusy || want === classOn) return;
    classBusy = true;
    (want ? enterClass() : leaveClass()).finally(() => {
      classBusy = false;
      applyCalib();
    });
  }

  async function enterClass() {
    if (activeCall) { try { activeCall.close(); } catch (e) {} }
    await startLocalMedia();
    classOn = true;
    buildMix();
    showClassVideo();
    if (classCode) startClassPeer(); // without a class code the console says how to add one
  }

  async function leaveClass() {
    classOn = false;
    students.forEach(s => { try { s.conn.send({ t: 'closed' }); } catch (e) {} });
    await new Promise(r => setTimeout(r, 300)); // let that message arrive before hanging up
    endTurn();
    students.forEach(s => dropStudent(s.id));
    queue = [];
    endShare();
    if (classPeer) { try { classPeer.destroy(); } catch (e) {} classPeer = null; }
    if (mix) { mix.ctx.close().catch(() => {}); mix = null; }
    $('classVideo').srcObject = null;
    stopLocalMedia();
  }

  async function startClassPeer() {
    if (!classOn) return;
    const p = new Peer(HH.classId(classCode), { config: await HH.iceConfig(), debug: 1 });
    classPeer = p;
    p.on('open', () => classRetry.reset());
    p.on('connection', attachStudent);
    p.on('call', receiveSpeaker);
    p.on('disconnected', () => {
      setTimeout(() => { if (classPeer === p && !p.destroyed && p.disconnected) p.reconnect(); }, classRetry.next());
    });
    p.on('error', err => {
      if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        if (classPeer !== p) return;
        try { p.destroy(); } catch (e) {}
        classPeer = null;
        setTimeout(() => { if (classOn && !classPeer) startClassPeer(); }, classRetry.next());
      }
    });
  }

  // The picture everyone gets: the teacher's screen while they share it, otherwise the iMac camera.
  function classVideoTrack() {
    if (shareStream && shareStream.getVideoTracks()[0]) return shareStream.getVideoTracks()[0];
    return localStream ? localStream.getVideoTracks()[0] : null;
  }

  function micTrack() {
    return localStream ? localStream.getAudioTracks()[0] : null;
  }

  // The speaker hears only the room; everyone else hears the room and the speaker.
  function audioTrackFor(id) {
    if (id === floor || !mix) return micTrack();
    return mix.dest.stream.getAudioTracks()[0];
  }

  function buildMix() {
    if (mix || !localStream || !micTrack()) return;
    try {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream([micTrack()])).connect(dest);
      mix = { ctx, dest, speakerSrc: null };
    } catch (e) { mix = null; }
  }

  function showClassVideo() {
    const track = classVideoTrack();
    const v = $('classVideo');
    v.srcObject = track ? new MediaStream([track]) : null;
    v.play().catch(() => {});
    document.body.classList.toggle('sharing', !!shareStream);
  }

  // Swap the picture or sound in every student's call without hanging up.
  function refreshStudentTracks() {
    students.forEach(s => {
      const pc = s.out && s.out.peerConnection;
      if (!pc) return;
      pc.getSenders().forEach(sender => {
        const kind = sender.track ? sender.track.kind : null;
        const want = kind === 'video' ? classVideoTrack() : kind === 'audio' ? audioTrackFor(s.id) : null;
        if (want && sender.track !== want) sender.replaceTrack(want).catch(() => {});
      });
    });
  }

  function capBitrate(call) {
    const pc = call.peerConnection;
    const apply = () => {
      pc.getSenders().forEach(sender => {
        if (!sender.track || sender.track.kind !== 'video') return;
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) return;
        params.encodings[0].maxBitrate = VIDEO_KBPS * 1000;
        sender.setParameters(params).catch(() => {});
      });
    };
    pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'connected') apply(); });
  }

  function attachStudent(conn) {
    const name = String((conn.metadata && conn.metadata.name) || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Student';
    conn.on('open', () => {
      if (!classOn) { conn.send({ t: 'closed' }); setTimeout(() => conn.close(), 500); return; }
      if (students.size >= MAX_STUDENTS) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); return; }
      const s = { id: conn.peer, name, conn, out: null };
      const old = students.get(s.id);
      if (old) dropStudent(old.id);
      students.set(s.id, s);
      conn.send({ t: 'welcome', id: s.id, chat, teacher: HH.teacher() });
      sendClass(s);
      feedSpeaker(s);
      broadcastQueue();
    });
    conn.on('data', msg => {
      const s = students.get(conn.peer);
      if (!s || s.conn !== conn || !msg || typeof msg !== 'object') return;
      if (msg.t === 'hand') {
        queue = queue.filter(id => id !== s.id);
        if (msg.up && floor !== s.id) queue.push(s.id);
        broadcastQueue();
      }
      if (msg.t === 'chat') postChat(s.name, msg.text, 'student');
      if (msg.t === 'done' && floor === s.id) endTurn();
    });
    const gone = () => { const s = students.get(conn.peer); if (s && s.conn === conn) { dropStudent(s.id); broadcastQueue(); } };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  // Send the class picture and sound to a student; call again if that call drops while they're here.
  function sendClass(s) {
    const video = classVideoTrack(), audio = audioTrackFor(s.id);
    if (!classPeer || (!video && !audio)) return;
    const call = classPeer.call(s.id, new MediaStream([video, audio].filter(Boolean)), { metadata: { role: 'class' } });
    s.out = call;
    capBitrate(call);
    const again = () => {
      if (s.out !== call) return;
      s.out = null;
      setTimeout(() => { if (students.get(s.id) === s && !s.out && classOn) sendClass(s); }, 2000);
    };
    call.on('close', again);
    call.on('error', again);
  }

  function dropStudent(id) {
    const s = students.get(id);
    if (!s) return;
    students.delete(id);
    queue = queue.filter(q => q !== id);
    if (floor === id) endTurn();
    const out = s.out;
    s.out = null;
    if (out) { try { out.close(); } catch (e) {} }
    try { s.conn.close(); } catch (e) {}
  }

  function broadcastQueue() {
    const who = id => { const s = students.get(id); return s ? { id, name: s.name } : null; };
    const msg = { t: 'queue', queue: queue.map(who).filter(Boolean), floor: floor ? who(floor) : null, count: students.size };
    students.forEach(s => { if (s.conn.open) s.conn.send(msg); });
  }

  function classCommand(msg) {
    if (!classOn) return;
    if (msg.cmd === 'floor' && students.has(msg.id)) giveFloor(msg.id);
    if (msg.cmd === 'next') { if (queue.length) giveFloor(queue[0]); else endTurn(); }
    if (msg.cmd === 'end') endTurn();
    if (msg.cmd === 'stopShare') endShare(); // hanging up alone takes a while to be noticed
    if (msg.cmd === 'remove' && students.has(msg.id)) {
      const s = students.get(msg.id);
      try { s.conn.send({ t: 'removed' }); } catch (e) {}
      setTimeout(() => { dropStudent(msg.id); broadcastQueue(); }, 300);
    }
  }

  function giveFloor(id) {
    if (floor === id) return;
    endTurn();
    floor = id;
    queue = queue.filter(q => q !== id);
    const s = students.get(id);
    if (s && s.conn.open) s.conn.send({ t: 'floor', you: true });
    refreshStudentTracks();
    broadcastQueue();
  }

  function endTurn() {
    if (!floor) return;
    const s = students.get(floor);
    if (s && s.conn.open) s.conn.send({ t: 'floor', you: false });
    floor = null;
    stopSpeaker();
    refreshStudentTracks();
    broadcastQueue();
  }

  // The student with the floor calls in with their mic (and camera if they allow it).
  function receiveSpeaker(call) {
    if (!call.metadata || call.metadata.role !== 'speaker' || call.peer !== floor) { call.close(); return; }
    stopSpeaker();
    speakerCall = call;
    call.answer();
    call.on('stream', stream => {
      if (speakerCall !== call) return;
      speakerStream = stream;
      const out = $('speakerAudio');
      out.srcObject = stream;
      playWithSound(out);
      if (mix && stream.getAudioTracks()[0]) {
        mix.speakerSrc = mix.ctx.createMediaStreamSource(stream);
        mix.speakerSrc.connect(mix.dest);
      }
      students.forEach(feedSpeaker);
      consoles.forEach(feedSpeaker);
    });
    const end = () => { if (speakerCall === call) stopSpeaker(); };
    call.on('close', end);
    call.on('error', end);
  }

  function stopSpeaker() {
    const call = speakerCall;
    speakerCall = null;
    speakerStream = null;
    if (call) { try { call.close(); } catch (e) {} }
    if (mix && mix.speakerSrc) { try { mix.speakerSrc.disconnect(); } catch (e) {} mix.speakerSrc = null; }
    $('speakerAudio').srcObject = null;
    const feeds = speakerFeeds;
    speakerFeeds = [];
    feeds.forEach(f => { try { f.close(); } catch (e) {} });
  }

  // Show the speaker's camera to the other students (their voice is already in the mix) and to the
  // console. `to` is a student record or a console data connection.
  function feedSpeaker(to) {
    if (!speakerStream || !speakerStream.getVideoTracks().length) return;
    const isStudent = !!to.conn;
    if (isStudent && to.id === floor) return;
    if (!isStudent && (!to.metadata || to.metadata.role !== 'console' || !to.open)) return;
    const via = isStudent ? classPeer : peer;
    if (!via) return;
    const s = students.get(floor);
    const call = via.call(isStudent ? to.id : to.peer, new MediaStream(speakerStream.getVideoTracks()),
      { metadata: { role: 'speaker', name: s ? s.name : '' } });
    speakerFeeds.push(call);
  }

  // The teacher's screen, captured by the console (it needs a click there) and sent here.
  function receiveShare(call) {
    const fromConsole = [...consoles].some(c => c.peer === call.peer);
    if (!classOn || !fromConsole) { call.close(); return; }
    if (shareCall) { try { shareCall.close(); } catch (e) {} }
    shareCall = call;
    call.answer();
    call.on('stream', stream => {
      if (shareCall !== call) return;
      shareStream = stream;
      showClassVideo();
      refreshStudentTracks();
    });
    const end = () => { if (shareCall === call) endShare(); };
    call.on('close', end);
    call.on('error', end);
  }

  function endShare() {
    const call = shareCall;
    shareCall = shareStream = null;
    if (call) { try { call.close(); } catch (e) {} }
    showClassVideo();
    refreshStudentTracks();
  }

  function postChat(name, text, from) {
    const t = String(text || '').trim().slice(0, 500);
    if (!t || !classOn) return;
    const msg = { name, text: t, from, at: Date.now() };
    chat.push(msg);
    if (chat.length > 50) chat.shift();
    students.forEach(s => { if (s.conn.open) s.conn.send({ t: 'chat', msg }); });
    consoles.forEach(c => { if (c.open && c.metadata && c.metadata.role === 'console') c.send({ t: 'chat', msg }); });
  }

  function showNotice(text) {
    const n = $('notice');
    n.textContent = text;
    n.hidden = false;
  }
})();
