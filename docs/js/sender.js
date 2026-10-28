// Phone page: sends the caller's camera and mic to the head, shows the visitors.
(() => {
  const $ = id => document.getElementById(id);
  const room = HH.room();
  const retry = HH.backoff(1000, 15000);

  let peer = null;
  let call = null;
  let localStream = null;
  let facing = 'user';
  let retryTimer = null;
  let answerTimer = null;
  let lastStats = null;
  let failures = 0;

  if (!room) {
    $('startRoom').textContent = 'No room code. Open the link from the HoloHead home page.';
    $('go').disabled = true;
    return;
  }
  $('startRoom').textContent = `Room: ${room}`;

  $('go').addEventListener('click', async () => {
    $('go').disabled = true;
    try {
      await startCamera();
    } catch (e) {
      $('startRoom').textContent = `Camera or mic blocked (${e.name}). In Settings → Safari → Camera and Microphone, choose Allow, then reload.`;
      $('go').disabled = false;
      return;
    }
    $('start').hidden = true;
    HH.keepAwake();
    startPeer();
    setInterval(updateStats, 2000);
  });

  // ?auto=1 skips the Start button (handy for testing on a computer).
  if (HH.params.get('auto') === '1') $('go').click();

  $('mute').addEventListener('click', () => {
    const track = localStream && localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    $('mute').classList.toggle('on', !track.enabled);
    $('mute').textContent = track.enabled ? 'Mute' : 'Unmute';
  });

  $('flip').addEventListener('click', async () => {
    facing = facing === 'user' ? 'environment' : 'user';
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: videoConstraints() });
      const track = fresh.getVideoTracks()[0];
      localStream.getVideoTracks().forEach(t => { localStream.removeTrack(t); t.stop(); });
      localStream.addTrack(track);
      $('self').srcObject = localStream;
      $('self').classList.toggle('rear', facing !== 'user');
      const sender = call && call.peerConnection && call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) await sender.replaceTrack(track);
    } catch (e) {
      facing = facing === 'user' ? 'environment' : 'user';
    }
  });

  const toggleFrame = () => {
    $('selfBox').classList.toggle('big');
    $('frame').classList.toggle('on', $('selfBox').classList.contains('big'));
  };
  $('frame').addEventListener('click', toggleFrame);
  $('selfBox').addEventListener('click', toggleFrame);

  $('reconnect').addEventListener('click', () => {
    retry.reset();
    restartPeer(0);
  });

  function videoConstraints() {
    return { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  }

  async function startCamera() {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints(),
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    $('self').srcObject = localStream;
  }

  function setStatus(text) { $('status').textContent = text; }

  async function startPeer() {
    setStatus('Connecting…');
    peer = new Peer({ config: await HH.iceConfig(), debug: 1 });
    peer.on('open', placeCall);
    peer.on('disconnected', () => {
      // Lost the signaling server; an active call can keep running without it.
      setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, retry.next());
    });
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') {
        setStatus('Head is offline. Retrying…');
        scheduleCall();
      } else if (!call) {
        setStatus(`Connection problem (${err.type}). Retrying…`);
        restartPeer(retry.next());
      }
    });
  }

  function restartPeer(delay) {
    clearTimeout(retryTimer);
    clearTimeout(answerTimer);
    if (call) { try { call.close(); } catch (e) {} call = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    retryTimer = setTimeout(startPeer, delay);
  }

  function scheduleCall() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      if (peer && !peer.destroyed && peer.open) placeCall();
      else restartPeer(0);
    }, retry.next());
  }

  async function placeCall() {
    if (call) { try { call.close(); } catch (e) {} }
    setStatus('Calling the head…');
    // Relay passwords expire after two days; pick up the current ones for every call.
    const config = await HH.iceConfig();
    if (!peer || peer.destroyed || !peer.open) return scheduleCall();
    peer.options.config = config;
    const c = peer.call(HH.headId(room), localStream);
    call = c;
    lastStats = null;

    // No picture back within 20 s: try again.
    clearTimeout(answerTimer);
    answerTimer = setTimeout(() => { if (call === c && !$('visitor').srcObject) dropAndRetry(c, 'No answer. Retrying…'); }, 20000);

    // The stream event fires before the network path is up; only call it live once connected.
    const pc = c.peerConnection;
    let remote = null;
    const goLiveIfReady = () => {
      if (call !== c || !remote || pc.connectionState !== 'connected' || $('visitor').srcObject) return;
      clearTimeout(answerTimer);
      retry.reset();
      failures = 0;
      $('visitor').srcObject = remote;
      $('visitor').play().catch(() => {});
      setStatus('Live');
    };
    c.on('stream', stream => {
      if (call !== c) return;
      remote = stream;
      setStatus('Head answered. Connecting video…');
      goLiveIfReady();
    });
    c.on('close', () => { if (call === c) dropAndRetry(c, 'Call ended. Reconnecting…'); });
    c.on('error', () => { if (call === c) dropAndRetry(c, 'Call error. Reconnecting…'); });

    let lostTimer = null;
    pc.addEventListener('connectionstatechange', () => {
      clearTimeout(lostTimer);
      if (call !== c) return;
      goLiveIfReady();
      if (pc.connectionState === 'failed') {
        // Never connected: the networks are blocking a direct path. A TURN relay fixes that.
        if (!$('visitor').srcObject) failures++;
        const hint = failures >= 2 && !HH.settings().turnUrls
          ? 'Direct connection blocked by the network. Set up a relay (see home page). Retrying…'
          : 'Connection lost. Reconnecting…';
        dropAndRetry(c, hint);
      }
      if (pc.connectionState === 'disconnected') {
        setStatus('Connection shaky…');
        lostTimer = setTimeout(() => { if (call === c) dropAndRetry(c, 'Connection lost. Reconnecting…'); }, 8000);
      }
    });
  }

  function dropAndRetry(c, text) {
    if (call !== c) return;
    call = null;
    try { c.close(); } catch (e) {}
    $('visitor').srcObject = null;
    setStatus(text);
    scheduleCall();
  }

  async function updateStats() {
    if (!call || !call.peerConnection || !$('visitor').srcObject) return;
    try {
      lastStats = await HH.callStats(call.peerConnection, lastStats);
      const route = lastStats.route === 'relay' ? 'relay' : lastStats.route === 'direct' ? 'direct' : '';
      setStatus(`Live${route ? ` · ${route}` : ''}${lastStats.rtt != null ? ` · ${lastStats.rtt} ms` : ''}`);
    } catch (e) { /* stats are optional */ }
  }
})();
