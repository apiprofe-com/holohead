// Console page: status and calibration for the projection, linked over a PeerJS data connection
// (so it works from a second Chrome window, or from a laptop or phone standing next to the head).
(() => {
  const $ = id => document.getElementById(id);
  const room = HH.room();
  const retry = HH.backoff(1000, 10000);
  let calib = HH.load(HH.KEYS.calib, HH.DEFAULT_CALIB);
  let peer = null;
  let conn = null;
  let sendTimer = null;
  let lastStatusAt = 0;

  const GROUPS = [
    ['Line up with the foam head', [
      ['scale', 'Size', 0.2, 3, 0.01],
      ['x', 'Left / right', -60, 60, 0.1],
      ['y', 'Up / down', -60, 60, 0.1],
      ['rotate', 'Rotate', -45, 45, 0.1],
    ]],
    ['Face inside the oval', [
      ['zoom', 'Zoom', 0.3, 3, 0.01],
      ['faceX', 'Left / right', -50, 50, 0.1],
      ['faceY', 'Up / down', -50, 50, 0.1],
    ]],
    ['Oval mask', [
      ['maskW', 'Width', 5, 70, 0.1],
      ['maskH', 'Height', 5, 70, 0.1],
      ['feather', 'Soft edge', 0, 80, 0.5],
    ]],
    ['Picture', [
      ['brightness', 'Brightness', 0.2, 2.5, 0.01],
      ['contrast', 'Contrast', 0.2, 2.5, 0.01],
      ['saturate', 'Color', 0, 2.5, 0.01],
    ]],
    ['Corner warp (% of the face area)', [
      ['warp.0', 'Top-left →', -40, 40, 0.1], ['warp.1', 'Top-left ↓', -40, 40, 0.1],
      ['warp.2', 'Top-right →', -40, 40, 0.1], ['warp.3', 'Top-right ↓', -40, 40, 0.1],
      ['warp.4', 'Bottom-right →', -40, 40, 0.1], ['warp.5', 'Bottom-right ↓', -40, 40, 0.1],
      ['warp.6', 'Bottom-left →', -40, 40, 0.1], ['warp.7', 'Bottom-left ↓', -40, 40, 0.1],
    ]],
  ];

  if (!room) {
    document.querySelector('.page').innerHTML = '<h1>HoloHead Console</h1><p>No room code. Open this from the <a href="index.html">HoloHead home page</a>.</p>';
    return;
  }

  $('room').textContent = room;
  $('phoneLink').href = new URL(`sender.html?room=${room}`, location.href).href;

  buildControls();
  bindActions();
  startPreview();
  connect();
  setInterval(() => { if (Date.now() - lastStatusAt > 4000) markStale(); }, 2000);

  // ---------- Controls ----------

  function get(path) {
    const [key, i] = path.split('.');
    return i === undefined ? calib[key] : calib[key][+i];
  }

  function set(path, value) {
    const [key, i] = path.split('.');
    if (i === undefined) calib[key] = value;
    else { calib[key] = [...calib[key]]; calib[key][+i] = value; }
  }

  function buildControls() {
    const root = $('controls');
    root.innerHTML = '';
    for (const [title, sliders] of GROUPS) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<h2>${title}</h2>`;
      for (const [path, label, min, max, step] of sliders) {
        const row = document.createElement('div');
        row.className = 'slider';
        row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
        const input = row.querySelector('input'), out = row.querySelector('output');
        input.value = get(path);
        out.textContent = (+get(path)).toFixed(step < 1 ? 2 : 0);
        input.addEventListener('input', () => {
          set(path, +input.value);
          out.textContent = (+input.value).toFixed(step < 1 ? 2 : 0);
          push();
        });
        input.addEventListener('dblclick', () => {
          const def = path.startsWith('warp') ? 0 : HH.DEFAULT_CALIB[path];
          set(path, def); input.value = def; out.textContent = (+def).toFixed(step < 1 ? 2 : 0); push();
        });
        card.appendChild(row);
      }
      root.appendChild(card);
    }
    root.appendChild(layoutCard());
    syncToggles();
  }

  function layoutCard() {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h2>Screen layout</h2>
      <div class="field"><label>Layout</label>
        <select data-key="layout"><option value="split">Split: face + side video</option><option value="face">Face only</option></select></div>
      <div class="field"><label>Face goes on the</label>
        <select data-key="faceSide"><option value="right">Right</option><option value="left">Left</option></select></div>
      <div class="slider"><label>Face width</label><input data-key="faceWidth" type="range" min="20" max="80" step="1"><output></output></div>
      <div class="field"><label>Side video or page (YouTube links work)</label>
        <input data-key="sideUrl" type="text" placeholder="https://www.youtube.com/watch?v=…"></div>
      <div class="field"><label>While Lucas is offline</label>
        <select data-key="idle"><option value="glow">Soft glow</option><option value="black">Black</option><option value="text">"Waiting for Lucas…"</option></select></div>
      <div class="field"><label>Status dot in the corner</label>
        <select data-key="showDot"><option value="false">Hidden</option><option value="true">Shown</option></select></div>`;
    card.querySelectorAll('[data-key]').forEach(el => {
      const key = el.dataset.key;
      const show = () => { if (el.type === 'range') el.nextElementSibling.textContent = `${calib[key]}%`; };
      el.value = String(calib[key]);
      show();
      el.addEventListener(el.type === 'text' ? 'change' : 'input', () => {
        let v = el.value;
        if (el.type === 'range') v = +v;
        if (key === 'showDot') v = v === 'true';
        if (key === 'sideUrl') { v = HH.toEmbedUrl(v); el.value = v; }
        calib[key] = v;
        show();
        push();
      });
    });
    return card;
  }

  function syncToggles() {
    document.querySelectorAll('[data-toggle]').forEach(b => b.classList.toggle('on', !!calib[b.dataset.toggle]));
  }

  function bindActions() {
    document.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
      const key = b.dataset.toggle;
      calib[key] = !calib[key];
      syncToggles();
      push();
    }));
    $('reconnect').addEventListener('click', () => send({ t: 'cmd', cmd: 'reconnect' }));
    $('reload').addEventListener('click', () => send({ t: 'cmd', cmd: 'reload' }));
    $('reset').addEventListener('click', () => {
      if (!confirm('Reset all calibration to the defaults? (Layout and side video are kept.)')) return;
      const keep = { layout: calib.layout, faceSide: calib.faceSide, faceWidth: calib.faceWidth, sideUrl: calib.sideUrl, idle: calib.idle };
      calib = { ...HH.DEFAULT_CALIB, ...keep };
      buildControls();
      push();
    });
  }

  // Send changes to the projection, at most ~30 times a second.
  function push() {
    HH.save(HH.KEYS.calib, calib);
    if (sendTimer) return;
    sendTimer = setTimeout(() => { sendTimer = null; send({ t: 'calib', calib }); }, 33);
  }

  function send(msg) {
    if (!conn || !conn.open) return;
    // Flush a pending calibration change first, so a command never overtakes it.
    if (sendTimer && msg.t !== 'calib') {
      clearTimeout(sendTimer);
      sendTimer = null;
      conn.send({ t: 'calib', calib });
    }
    conn.send(msg);
  }

  // ---------- Link to the projection ----------

  function connect() {
    pill('sLink', 'connecting', 'warn');
    peer = new Peer({ config: HH.iceConfig(), debug: 1 });
    peer.on('open', () => {
      conn = peer.connect(HH.headId(room), { metadata: { role: 'console' }, reliable: true });
      conn.on('open', () => { retry.reset(); pill('sLink', 'connected', 'good'); });
      conn.on('data', onData);
      conn.on('close', reconnect);
      conn.on('error', reconnect);
    });
    peer.on('error', reconnect);
    peer.on('disconnected', () => { if (!conn || !conn.open) reconnect(); });
  }

  function reconnect() {
    pill('sLink', 'projection not reachable, retrying', 'bad');
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; conn = null; }
    clearTimeout(reconnect.timer);
    reconnect.timer = setTimeout(connect, retry.next());
  }

  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'calib') {
      calib = { ...HH.DEFAULT_CALIB, ...msg.calib };
      HH.save(HH.KEYS.calib, calib);
      buildControls();
    }
    if (msg.t === 'status') showStatus(msg);
  }

  function showStatus(s) {
    lastStatusAt = Date.now();
    pill('sPeer', s.peer === 'ready' ? 'ready' : s.peer, s.peer === 'ready' ? 'good' : 'warn');
    pill('sLive', s.live ? 'live' : 'not connected', s.live ? 'good' : '');
    const st = s.stats || {};
    $('sRoute').textContent = s.live ? (st.route === 'relay' ? 'TURN relay' : st.route === 'direct' ? 'direct' : '…') + (s.relayForced ? ' (relay forced)' : '') : '—';
    $('sKbps').textContent = s.live && st.kbps ? `${st.kbps} kbps` : '—';
    $('sLoss').textContent = s.live ? `${st.lossPct || 0}%` : '—';
    $('sRes').textContent = s.live && st.res ? st.res : '—';
    $('sRtt').textContent = s.live && st.rtt != null ? `${st.rtt} ms` : '—';
    $('mic').style.width = `${Math.min(100, s.mic * 140)}%`;
    $('oneScreen').hidden = !(s.forcedTv || s.extended === false);
    $('noCam').hidden = s.cam;
    if (!s.cam) $('noCam').textContent = `The projection can't use the iMac camera or mic, so Lucas can't see visitors. ${s.camError || ''}`;
  }

  function markStale() {
    pill('sPeer', 'no news from projection', 'bad');
  }

  function pill(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = `pill ${cls || ''}`;
  }

  // ---------- Local camera preview ----------

  async function startPreview() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } }, audio: false });
      $('preview').srcObject = stream;
    } catch (e) {
      $('previewNote').textContent = `No camera preview on this computer (${e.name}).`;
    }
  }
})();
