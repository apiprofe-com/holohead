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
  let shareStream = null;
  let shareCall = null;
  let classState = null;

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
  bindClass();
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
      <div class="field"><label>While nobody is calling</label>
        <select data-key="idle"><option value="glow">Soft glow (halo) on the head</option><option value="side">Side video fills the screen (screensaver)</option><option value="black">Black</option><option value="text">"Waiting…" text</option></select></div>
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
      const keep = { layout: calib.layout, faceSide: calib.faceSide, faceWidth: calib.faceWidth, sideUrl: calib.sideUrl, idle: calib.idle, classMode: calib.classMode };
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

  async function connect() {
    pill('sLink', 'connecting', 'warn');
    peer = new Peer({ config: await HH.iceConfig(), debug: 1 });
    peer.on('open', () => {
      conn = peer.connect(HH.headId(room), { metadata: { role: 'console' }, reliable: true });
      conn.on('open', () => { retry.reset(); pill('sLink', 'connected', 'good'); });
      conn.on('data', onData);
      conn.on('close', reconnect);
      conn.on('error', reconnect);
    });
    // The projection sends the current speaker's camera here during office hours.
    peer.on('call', call => {
      if (!call.metadata || call.metadata.role !== 'speaker') { call.close(); return; }
      call.answer();
      call.on('stream', stream => { $('speakerVideo').srcObject = stream; $('speakerBox').hidden = false; });
      const end = () => { $('speakerVideo').srcObject = null; $('speakerBox').hidden = true; };
      call.on('close', end);
      call.on('error', end);
    });
    peer.on('error', reconnect);
    peer.on('disconnected', () => { if (!conn || !conn.open) reconnect(); });
  }

  function reconnect() {
    pill('sLink', 'projection not reachable, retrying', 'bad');
    stopShare();
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
    if (msg.t === 'chatHistory') { $('consoleChat').textContent = ''; (msg.chat || []).forEach(addChat); }
    if (msg.t === 'chat') addChat(msg.msg);
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
    preview(s.live || !!(s.class && s.class.on));
    showClass(s.class);
    $('mic').style.width = `${Math.min(100, s.mic * 140)}%`;
    $('oneScreen').hidden = !(s.forcedTv || s.extended === false);
    $('noCam').hidden = s.cam;
    if (!s.cam) $('noCam').textContent = `The projection can't use the iMac camera or mic, so the caller and students can't see the room. ${s.camError || ''}`;
  }

  function markStale() {
    pill('sPeer', 'no news from projection', 'bad');
    preview(false);
  }

  function pill(id, text, cls) {
    const el = $(id);
    el.textContent = text;
    el.className = `pill ${cls || ''}`;
  }

  // ---------- Office hours (class mode) ----------

  function bindClass() {
    $('copyLink').addEventListener('click', () => {
      const link = $('classLink').value;
      if (!link) return;
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).catch(() => {
        $('classLink').select();
        document.execCommand('copy');
      });
      $('copyLink').textContent = 'Copied';
      setTimeout(() => { $('copyLink').textContent = 'Copy'; }, 1500);
    });
    $('nextBtn').addEventListener('click', () => send({ t: 'class', cmd: 'next' }));
    $('endBtn').addEventListener('click', () => send({ t: 'class', cmd: 'end' }));
    $('shareBtn').addEventListener('click', () => (shareStream ? stopShare() : startShare()));
    $('consoleChatForm').addEventListener('submit', e => {
      e.preventDefault();
      const text = $('consoleChatText').value.trim();
      if (!text) return;
      send({ t: 'chat', text });
      $('consoleChatText').value = '';
    });
  }

  function showClass(c) {
    if (!c) return;
    classState = c;
    $('classLink').value = c.code ? new URL(`class.html?c=${c.code}`, location.href).href : '';
    $('noClass').hidden = !!c.code;
    pill('sClass', c.on ? (c.peer === 'ready' ? `open · ${c.students.length} of ${c.max}` : 'opening…') : 'off',
      c.on ? (c.peer === 'ready' ? 'good' : 'warn') : '');
    $('shareBtn').disabled = !c.on;
    if (!c.on && shareStream) stopShare();
    $('shareBtn').classList.toggle('on', !!shareStream);
    $('shareBtn').textContent = shareStream ? 'Stop sharing' : 'Share screen';
    $('queueCard').hidden = $('chatCard').hidden = !c.on;
    if (!c.speakerLive) { $('speakerBox').hidden = true; $('speakerVideo').srcObject = null; }
    $('sCount').textContent = c.on ? `(${c.students.length} here, ${c.queue.length} waiting)` : '';
    $('endBtn').disabled = !c.floor;
    $('nextBtn').disabled = !c.queue.length;
    renderQueue(c);
  }

  // Speaker first, then raised hands in order, then everyone else.
  function renderQueue(c) {
    const byId = new Map(c.students.map(s => [s.id, s]));
    const order = [c.floor, ...c.queue, ...c.students.map(s => s.id)].filter((id, i, a) => id && byId.has(id) && a.indexOf(id) === i);
    const key = JSON.stringify([order, c.floor, c.queue]);
    if (renderQueue.key === key) return;
    renderQueue.key = key;
    const list = $('queueList');
    list.textContent = '';
    if (!order.length) { list.innerHTML = '<p class="sub" style="margin:0">Nobody has joined yet.</p>'; return; }
    for (const id of order) {
      const s = byId.get(id);
      const row = document.createElement('div');
      row.className = `queue-row${id === c.floor ? ' speaking' : ''}`;
      const who = document.createElement('span');
      who.className = 'who';
      const pos = c.queue.indexOf(id);
      who.textContent = `${id === c.floor ? '🎙 ' : pos >= 0 ? `✋ ${pos + 1}. ` : ''}${s.name}`;
      row.appendChild(who);
      if (id !== c.floor) row.appendChild(button('Give floor', () => send({ t: 'class', cmd: 'floor', id })));
      row.appendChild(button('Remove', () => {
        if (confirm(`Remove ${s.name} from office hours?`)) send({ t: 'class', cmd: 'remove', id });
      }));
      list.appendChild(row);
    }
  }

  function button(text, onClick) {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // Screen sharing needs a click in a normal window, so it happens here and goes to the projection.
  async function startShare() {
    if (!peer || !conn || !conn.open) return;
    try {
      shareStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
    } catch (e) {
      shareStream = null;
      return;
    }
    shareStream.getVideoTracks()[0].addEventListener('ended', stopShare); // Chrome's own "Stop sharing" bar
    shareCall = peer.call(HH.headId(room), shareStream, { metadata: { role: 'share' } });
    shareCall.on('close', stopShare);
    shareCall.on('error', stopShare);
    if (classState) showClass(classState);
  }

  function stopShare() {
    const call = shareCall, stream = shareStream;
    shareCall = shareStream = null;
    if (call) { send({ t: 'class', cmd: 'stopShare' }); try { call.close(); } catch (e) {} }
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (classState) showClass(classState);
  }

  function addChat(m) {
    if (!m || !m.text) return;
    const row = document.createElement('div');
    row.className = `msg ${m.from || ''}`;
    const who = document.createElement('b');
    who.textContent = m.name || '';
    const time = document.createElement('time');
    time.textContent = m.at ? new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const text = document.createElement('span');
    text.textContent = m.text;
    row.append(who, time, text);
    const log = $('consoleChat');
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  // ---------- Local camera preview ----------
  // Only during a call, so the camera light stays off while nobody is calling.

  let previewStream = null;
  let previewWanted = false;
  async function preview(on) {
    if (on === previewWanted) return;
    previewWanted = on;
    if (!on) {
      if (previewStream) previewStream.getTracks().forEach(t => t.stop());
      previewStream = null;
      $('preview').srcObject = null;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } }, audio: false });
      if (!previewWanted) { stream.getTracks().forEach(t => t.stop()); return; }
      previewStream = stream;
      $('preview').srcObject = stream;
    } catch (e) {
      $('previewNote').textContent = `No camera preview on this computer (${e.name}).`;
    }
  }
})();
