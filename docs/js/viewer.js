// Viewer page (iMac screen): shows the caller's video, forwarded by the projection, so people standing at
// the iMac (where the camera and mic are) can see them too. Muted: the projection already plays their voice.
(() => {
  const $ = id => document.getElementById(id);
  const room = HH.room();
  const retry = HH.backoff(1000, 10000);
  let peer = null;
  let conn = null;
  let feed = null;
  let calib = HH.load(HH.KEYS.calib, HH.DEFAULT_CALIB);

  if (!room) {
    $('idleText').textContent = 'No room code. Open this from the HoloHead home page.';
    $('idleText').style.display = 'flex';
    return;
  }

  HH.keepAwake();
  if (HH.teacher()) $('idleText').textContent = `${HH.teacher()} will be right back`;
  showIdle();
  connect();

  document.addEventListener('dblclick', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  setTimeout(() => $('hint').classList.add('gone'), 6000);

  async function connect() {
    peer = new Peer({ config: await HH.iceConfig(), debug: 1 });
    peer.on('open', () => {
      conn = peer.connect(HH.headId(room), { metadata: { role: 'viewer' }, reliable: true });
      conn.on('open', () => retry.reset());
      conn.on('data', msg => {
        if (msg && msg.t === 'calib') { calib = { ...HH.DEFAULT_CALIB, ...msg.calib }; if (!feed) showIdle(); }
      });
      conn.on('close', reconnect);
      conn.on('error', reconnect);
    });
    peer.on('call', call => {
      if (!call.metadata || call.metadata.role !== 'feed') { call.close(); return; }
      if (feed) { try { feed.close(); } catch (e) {} }
      feed = call;
      call.answer();
      call.on('stream', stream => {
        if (feed !== call) return;
        $('caller').srcObject = stream;
        $('caller').play().catch(() => {});
        document.body.classList.add('live');
      });
      const end = () => { if (feed === call) { feed = null; showIdle(); } };
      call.on('close', end);
      call.on('error', end);
    });
    peer.on('error', err => { if (err.type !== 'peer-unavailable' || !conn || !conn.open) reconnect(); });
    peer.on('disconnected', () => { if (!conn || !conn.open) reconnect(); });
  }

  function reconnect() {
    if (feed) { try { feed.close(); } catch (e) {} feed = null; }
    showIdle();
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; conn = null; }
    clearTimeout(reconnect.timer);
    reconnect.timer = setTimeout(connect, retry.next());
  }

  // While nobody is calling: the same side video as the projector (the fish), or a short note.
  function showIdle() {
    document.body.classList.remove('live');
    $('caller').srcObject = null;
    const url = calib.sideUrl ? HH.toEmbedUrl(calib.sideUrl) : '';
    HH.playVideo($('idleVideo'), url);
    $('idleText').style.display = url ? 'none' : 'flex';
  }
})();
