// Projection page: owns the call, shows the masked face, takes orders from the console.
(() => {
  const $ = id => document.getElementById(id);
  const room = HH.room();
  const forcedTv = HH.params.get('tv') === '1';
  let calib = HH.load(HH.KEYS.calib, HH.DEFAULT_CALIB);

  let peer = null;
  let activeCall = null;
  let localStream = null;
  let camError = '';
  let peerState = 'starting';
  let live = false;
  let lastStats = null;
  let micLevel = 0;
  const consoles = new Set();
  const retry = HH.backoff();

  if (!room) {
    showNotice('No room code. Open this page from the HoloHead home page, or add ?room=yourcode to the address.');
    return;
  }

  HH.keepAwake();
  applyCalib();
  window.addEventListener('resize', applyCalib);
  startLocalMedia().then(startPeer);
  setInterval(sendStatus, 1000);

  // ---------- Layout and calibration ----------

  function applyCalib() {
    const c = calib;
    const tv = c.tv || forcedTv;
    document.body.classList.toggle('tv', tv);
    document.body.classList.toggle('test', !!c.test);
    document.body.classList.toggle('live', live);
    document.body.dataset.idle = c.idle;
    $('blackout').style.display = c.blackout ? 'block' : 'none';
    $('dot').style.display = c.showDot ? 'block' : 'none';

    // Split screen
    // Screensaver: while Lucas is offline the side video fills the whole screen.
    const saver = !live && c.idle === 'side' && !!c.sideUrl && !c.test;
    const split = (c.layout === 'split' || saver) && c.sideUrl;
    const side = $('sidePane');
    side.style.display = split ? 'block' : 'none';
    $('facePane').style.display = saver ? 'none' : 'block';
    $('facePane').style.flexBasis = split ? `${c.faceWidth}%` : '100%';
    $('stage').style.flexDirection = c.faceSide === 'left' ? 'row' : 'row-reverse';
    const url = HH.toEmbedUrl(c.sideUrl);
    if (split && $('side').dataset.src !== url) {
      $('side').dataset.src = url;
      $('side').src = url;
    }
    if (!split && $('side').dataset.src) {
      $('side').dataset.src = '';
      $('side').src = 'about:blank';
    }

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

  // ---------- Camera and mic of the iMac (so Lucas can see visitors) ----------

  async function startLocalMedia() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      watchMic(localStream);
    } catch (e) {
      camError = `${e.name}: ${e.message}`;
      localStream = null;
    }
  }

  function watchMic(stream) {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      setInterval(() => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        micLevel = Math.max(peak / 128, micLevel * 0.8);
      }, 100);
    } catch (e) { /* meter is optional */ }
  }

  // ---------- Peer connection ----------

  function startPeer() {
    peerState = 'connecting';
    peer = new Peer(HH.headId(room), { config: HH.iceConfig(), debug: 1 });

    peer.on('open', () => { peerState = 'ready'; retry.reset(); setDot(); });
    peer.on('call', answer);
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

  function answer(call) {
    if (activeCall) { try { activeCall.close(); } catch (e) {} }
    activeCall = call;
    lastStats = null;
    call.answer(localStream || undefined);
    call.on('stream', stream => {
      if (activeCall !== call) return;
      const video = $('face');
      video.srcObject = stream;
      playWithSound(video);
      setLive(true);
    });
    call.on('close', () => { if (activeCall === call) { activeCall = null; setLive(false); } });
    call.on('error', () => { if (activeCall === call) { activeCall = null; setLive(false); } });

    // Drop calls whose network path died, so the sender's reconnect gets a clean slate.
    const pc = call.peerConnection;
    let lostTimer = null;
    pc.addEventListener('connectionstatechange', () => {
      clearTimeout(lostTimer);
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
  }

  function setDot() {
    $('dot').className = live ? 'live' : peerState === 'ready' ? 'ready' : 'down';
  }

  // ---------- Console link (any device, over a PeerJS data connection) ----------

  function attachConsole(conn) {
    conn.on('open', () => {
      consoles.add(conn);
      conn.send({ t: 'calib', calib });
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
    });
    conn.on('close', () => consoles.delete(conn));
    conn.on('error', () => consoles.delete(conn));
  }

  async function sendStatus() {
    if (activeCall && activeCall.peerConnection) {
      try { lastStats = await HH.callStats(activeCall.peerConnection, lastStats); } catch (e) {}
    }
    const status = {
      t: 'status', room, peer: peerState, live,
      stats: live ? lastStats : null,
      mic: Math.round(micLevel * 100) / 100,
      cam: !!localStream, camError,
      extended: window.screen.isExtended,
      forcedTv,
      relayForced: HH.settings().forceRelay,
    };
    consoles.forEach(c => { if (c.open) c.send(status); });
  }

  function showNotice(text) {
    const n = $('notice');
    n.textContent = text;
    n.hidden = false;
  }
})();
