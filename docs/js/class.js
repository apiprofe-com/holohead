// Student page (office hours): watch and hear the classroom, chat, and raise a hand. The mic and
// camera turn on only while Lucas gives this student the floor. Everything goes through the iMac
// (the projection page), never directly to other students.
(() => {
  const $ = id => document.getElementById(id);
  const code = HH.classCode();
  const NAME_KEY = 'holohead.name';
  const retry = HH.backoff(2000, 15000);
  let peer = null;
  let conn = null;
  let myId = null;
  let name = '';
  let handUp = false;
  let speakCall = null;
  let speakStream = null;
  let stopped = false; // removed, or the room is full: don't reconnect by ourselves
  const CLOSED = 'Office hours are closed right now. This page joins by itself when they open.';

  if (!code) {
    $('joinNote').textContent = 'This link is missing its class code. Ask for the office hours link again.';
    $('joinBtn').disabled = true;
    return;
  }

  try { $('name').value = localStorage.getItem(NAME_KEY) || ''; } catch (e) {}

  // Joining needs a click, which also lets the browser play the classroom sound.
  $('joinForm').addEventListener('submit', e => {
    e.preventDefault();
    name = $('name').value.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return;
    try { localStorage.setItem(NAME_KEY, name); } catch (err) {}
    $('join').hidden = true;
    $('room').hidden = false;
    HH.keepAwake();
    connect();
  });

  $('hand').addEventListener('click', () => {
    handUp = !handUp;
    send({ t: 'hand', up: handUp });
    showHand();
  });

  $('chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const text = $('chatText').value.trim();
    if (!text) return;
    send({ t: 'chat', text });
    $('chatText').value = '';
  });

  $('done').addEventListener('click', () => { send({ t: 'done' }); stopSpeaking(); });

  $('mute').addEventListener('click', () => {
    const track = speakStream && speakStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $('mute').textContent = track.enabled ? 'Mute' : 'Unmute';
    $('mute').classList.toggle('on', !track.enabled);
  });

  function send(msg) {
    if (conn && conn.open) conn.send(msg);
  }

  function setState(text) {
    $('state').textContent = text;
    $('state').hidden = !text;
  }

  // ---------- Connection to the classroom ----------

  async function connect() {
    if (stopped) return; // keep whatever the last message said while retrying
    const p = new Peer({ config: await HH.iceConfig(code), debug: 1 });
    peer = p;
    // Events from a peer we already replaced must not trigger another reconnect.
    const current = () => peer === p;
    p.on('open', () => {
      if (!current()) return;
      const c = p.connect(HH.classId(code), { metadata: { role: 'student', name }, reliable: true });
      conn = c;
      let opened = false;
      c.on('open', () => { opened = true; });
      c.on('data', onData);
      // Never got through: the classroom isn't open (it registers only while class mode is on).
      const lost = () => { if (conn === c) reconnect(opened ? 'Connection lost. Reconnecting…' : CLOSED); };
      c.on('close', lost);
      c.on('error', lost);
    });
    p.on('call', call => {
      if (!current()) { call.close(); return; }
      const role = call.metadata && call.metadata.role;
      call.answer();
      call.on('stream', stream => {
        if (role === 'class') {
          const v = $('classVideo');
          v.srcObject = stream;
          setState('');
          v.play().catch(e => {
            // Only when the browser blocks sound; other errors just mean a newer play() took over.
            if (e.name !== 'NotAllowedError') return;
            v.muted = true;
            v.play().catch(() => {});
            setState('Tap to turn on sound');
          });
        }
        if (role === 'speaker') {
          $('speakerVideo').srcObject = stream;
          $('speakerName').textContent = (call.metadata && call.metadata.name) || '';
          $('speakerTile').hidden = false;
        }
      });
      const end = () => { if (role === 'speaker') { $('speakerTile').hidden = true; $('speakerVideo').srcObject = null; } };
      call.on('close', end);
      call.on('error', end);
    });
    p.on('error', err => {
      if (!current()) return;
      if (err.type === 'peer-unavailable') reconnect(CLOSED);
      else reconnect('Connection problem. Retrying…');
    });
    p.on('disconnected', () => { if (current() && (!conn || !conn.open)) reconnect('Connection lost. Reconnecting…'); });
  }

  function reconnect(text) {
    if (reconnect.keep) { text = reconnect.keep; reconnect.keep = ''; }
    stopSpeaking();
    $('queueInfo').textContent = '';
    $('classVideo').srcObject = null;
    $('speakerTile').hidden = true;
    handUp = false;
    showHand();
    if (stopped) return;
    setState(text);
    const old = peer;
    peer = null;
    conn = null;
    if (old) { try { old.destroy(); } catch (e) {} }
    clearTimeout(reconnect.timer);
    reconnect.timer = setTimeout(connect, retry.next());
  }

  function stop(text) {
    stopped = true;
    setState(text);
    if (peer) { try { peer.destroy(); } catch (e) {} }
  }

  document.addEventListener('click', () => {
    const v = $('classVideo');
    if (v.muted && v.srcObject) { v.muted = false; v.play().catch(() => {}); setState(''); }
  });

  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'welcome') {
      myId = msg.id;
      retry.reset();
      $('chatLog').textContent = '';
      (msg.chat || []).forEach(addChat);
      setState('Joining the class video…');
    }
    if (msg.t === 'chat') addChat(msg.msg);
    if (msg.t === 'queue') showQueue(msg);
    if (msg.t === 'floor') { if (msg.you) startSpeaking(); else stopSpeaking(); }
    if (msg.t === 'full') stop('The room is full right now (5 people). Try again in a few minutes.');
    if (msg.t === 'removed') stop('You were removed from office hours.');
    if (msg.t === 'closed') reconnect.keep = 'Office hours just ended. This page joins by itself when they open again.';
  }

  // ---------- Queue and turns ----------

  function showHand() {
    $('hand').textContent = handUp ? '✋ Lower hand' : '✋ Raise hand';
    $('hand').classList.toggle('on', handUp);
  }

  function showQueue(q) {
    const pos = q.queue.findIndex(p => p.id === myId);
    handUp = pos >= 0;
    showHand();
    const parts = [];
    if (q.floor) parts.push(q.floor.id === myId ? 'You have the floor.' : `${q.floor.name} is speaking.`);
    if (pos >= 0) parts.push(`You're #${pos + 1} in line.`);
    else if (q.queue.length) parts.push(`${q.queue.length} waiting to speak.`);
    parts.push(`${q.count} here.`);
    $('queueInfo').textContent = parts.join(' ');
  }

  async function startSpeaking() {
    if (speakCall) return;
    try {
      speakStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch (e) {
      try {
        speakStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
      } catch (err) {
        addChat({ name: 'Office hours', text: `Your browser blocked the microphone (${err.name}). Allow it in the address bar, then raise your hand again.`, from: 'system' });
        send({ t: 'done' });
        return;
      }
    }
    if (!peer || !conn || !conn.open) { stopSpeaking(); return; }
    speakCall = peer.call(HH.classId(code), speakStream, { metadata: { role: 'speaker' } });
    $('selfVideo').srcObject = speakStream;
    $('selfTile').hidden = !speakStream.getVideoTracks().length;
    $('floorBanner').hidden = false;
    $('mute').textContent = 'Mute';
    $('mute').classList.remove('on');
  }

  function stopSpeaking() {
    if (speakCall) { try { speakCall.close(); } catch (e) {} speakCall = null; }
    if (speakStream) { speakStream.getTracks().forEach(t => t.stop()); speakStream = null; }
    $('selfVideo').srcObject = null;
    $('selfTile').hidden = true;
    $('floorBanner').hidden = true;
  }

  // ---------- Chat ----------

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
    const log = $('chatLog');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(row);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
})();
