// HoloHead shared helpers: room code, settings, ICE config, backoff, stats.
const HH = (() => {
  const KEYS = { settings: 'holohead.settings', calib: 'holohead.calib', room: 'holohead.room' };
  const CORAL_EMBED = 'https://www.youtube.com/embed/7i8ARjIeM2k?autoplay=1&mute=1&controls=0&playsinline=1&rel=0';

  // Everything the projection can be told to do. The console edits a copy and sends it over.
  const DEFAULT_CALIB = {
    // Whole picture (moves the oval and face together, to line up with the foam head)
    scale: 1, x: 0, y: 0, rotate: 0, mirror: false,
    // Corner warp, in % of the face pane: TL x,y  TR x,y  BR x,y  BL x,y
    warp: [0, 0, 0, 0, 0, 0, 0, 0],
    // Face inside the oval
    zoom: 1, faceX: 0, faceY: 0,
    // Picture
    brightness: 1, contrast: 1, saturate: 1,
    // Oval mask, radii in % of the pane, feather in % of the radius
    maskW: 30, maskH: 42, feather: 18,
    // Modes
    tv: false, test: false, blackout: false, idle: 'glow', showDot: false,
    // Split screen: 'face' only, or 'split' (face + side pane)
    layout: 'split', faceSide: 'right', faceWidth: 50, sideUrl: CORAL_EMBED,
    // Office hours from the classroom: the TV shows the iMac camera (or Lucas's shared screen)
    // and students join from the public class link.
    classMode: false,
  };

  const DEFAULT_SETTINGS = { turnUrls: '', turnUser: '', turnPass: '', forceRelay: false };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
    } catch (e) {
      return { ...fallback };
    }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode etc. */ }
  }

  const params = new URLSearchParams(location.search);

  function cleanRoom(r) {
    return (r || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  // Room code comes from ?room=, falling back to the last one used on this device.
  function room() {
    const fromUrl = cleanRoom(params.get('room'));
    if (fromUrl) {
      try { localStorage.setItem(KEYS.room, fromUrl); } catch (e) {}
      return fromUrl;
    }
    try { return cleanRoom(localStorage.getItem(KEYS.room)); } catch (e) { return ''; }
  }

  function newRoomCode() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, b => chars[b % chars.length]).join('');
  }

  const headId = r => `holohead-${r}-head`;
  const classId = c => `holohead-${c}-class`;

  // Public class code (for the student link). Never the private room code.
  function classCode() {
    return cleanRoom(params.get('class') || params.get('c'));
  }

  function settings() {
    const s = load(KEYS.settings, DEFAULT_SETTINGS);
    // The launcher passes relay settings in the address, since its Chrome windows have their own storage.
    if (params.get('turn')) {
      s.turnUrls = params.get('turn');
      s.turnUser = params.get('turnUser') || '';
      s.turnPass = params.get('turnPass') || '';
    }
    if (params.get('relay') === '1') s.forceRelay = true;
    return s;
  }

  // ICE servers: Google STUN, plus a TURN relay. A relay typed in by hand (or passed in the address)
  // wins; otherwise use the shared relay that a GitHub Action refreshes twice a day in turn.json,
  // encrypted with the room code so only people who know the room can use it.
  // `code` picks the turn.json entry to unlock: the room code by default, or the class code on the
  // student page (students never get the room code).
  async function iceConfig(code) {
    const s = settings();
    const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const turnUrls = s.turnUrls.split(/[\s,]+/).filter(Boolean);
    if (turnUrls.length) iceServers.push({ urls: turnUrls, username: s.turnUser, credential: s.turnPass });
    else iceServers.push(...await sharedRelay(code));
    return { iceServers, iceTransportPolicy: s.forceRelay ? 'relay' : 'all' };
  }

  const relayCache = {};

  async function sharedRelay(code) {
    const r = code || room();
    if (!r) return [];
    const cached = relayCache[r];
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.servers;
    try {
      const res = await fetch(new URL('turn.json', document.baseURI), { cache: 'no-store' });
      const file = await res.json();
      for (const entry of file.entries || []) {
        const servers = await decryptEntry(entry, r).catch(() => null);
        if (servers) {
          relayCache[r] = { at: Date.now(), servers };
          return servers;
        }
      }
    } catch (e) { /* no relay file yet, or offline: direct connections only */ }
    return [];
  }

  async function decryptEntry(entry, r) {
    const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(r), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: b64(entry.salt), iterations: entry.iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(entry.iv) }, key, b64(entry.data));
    return JSON.parse(new TextDecoder().decode(plain)).iceServers;
  }

  function backoff(min = 1000, max = 30000) {
    let n = 0;
    return {
      next() { const d = Math.min(max, min * 2 ** n++); return d + Math.random() * d * 0.2; },
      reset() { n = 0; },
    };
  }

  // Accept a YouTube watch/share link and turn it into an autoplaying, muted embed.
  function toEmbedUrl(url) {
    const u = (url || '').trim();
    const m = u.match(/(?:youtube\.com\/(?:watch\?v=|live\/)|youtu\.be\/)([\w-]{11})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0`;
    return u;
  }

  // Play a side video in an iframe and keep it playing. YouTube players sometimes stall or show an
  // error after running for days (e.g. "152 - 18"), so reload when the player reports an error or
  // hasn't been playing for two minutes, and every six hours regardless.
  function playVideo(frame, url) {
    if (frame.dataset.src === (url || '')) return;
    frame.dataset.src = url || '';
    frame.src = url ? withPlayerApi(url) : 'about:blank';
    if (frame.hhWatched) return;
    frame.hhWatched = true;
    let lastPlaying = Date.now();
    let loadedAt = Date.now();
    let lastTime = null;
    let retryTimer = null;
    let retryDelay = 15000;
    const reload = () => {
      if (!frame.dataset.src) return;
      lastPlaying = loadedAt = Date.now();
      frame.src = withPlayerApi(frame.dataset.src);
    };
    frame.addEventListener('load', () => {
      lastPlaying = Date.now();
      // Ask the YouTube player to report its state and errors to this page.
      const say = msg => { try { frame.contentWindow.postMessage(JSON.stringify(msg), '*'); } catch (e) {} };
      say({ event: 'listening', id: 1, channel: 'widget' });
      say({ event: 'command', func: 'addEventListener', args: ['onError'], id: 1, channel: 'widget' });
      say({ event: 'command', func: 'addEventListener', args: ['onStateChange'], id: 1, channel: 'widget' });
    });
    window.addEventListener('message', e => {
      if (e.source !== frame.contentWindow || !/youtube/.test(e.origin)) return;
      let d;
      try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
      if (!d) return;
      const info = d.info || {};
      const state = d.event === 'onStateChange' ? d.info : info.playerState;
      // Playing, or the clock moved forward since the last report.
      if (state === 1 || (typeof info.currentTime === 'number' && lastTime !== null && info.currentTime > lastTime)) {
        lastPlaying = Date.now();
        retryDelay = 15000;
      }
      if (typeof info.currentTime === 'number') lastTime = info.currentTime;
      if (d.event === 'onError' && !retryTimer) {
        // Wait longer after each failed try: 15 s, 30 s, 1 min… up to 10 min.
        retryTimer = setTimeout(() => { retryTimer = null; reload(); }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 600000);
      }
    });
    setInterval(() => {
      if (!frame.dataset.src || !/youtube\.com\/embed\//.test(frame.dataset.src)) return;
      if (document.visibilityState === 'hidden' || getComputedStyle(frame).visibility === 'hidden' || !frame.offsetWidth) {
        lastPlaying = Date.now();
        return;
      }
      if (retryTimer) return;
      if (Date.now() - lastPlaying > 120000 || Date.now() - loadedAt > 6 * 3600000) reload();
    }, 30000);
  }

  function withPlayerApi(url) {
    if (!/youtube\.com\/embed\//.test(url) || /enablejsapi=/.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}enablejsapi=1&origin=${encodeURIComponent(location.origin)}`;
  }

  // Summarise an RTCPeerConnection: direct vs relay, incoming bitrate, loss, resolution.
  async function callStats(pc, prev) {
    const out = { route: '?', kbps: 0, lossPct: 0, res: '', rtt: null, bytes: 0, at: performance.now() };
    if (!pc) return out;
    const report = await pc.getStats();
    let pair = null;
    report.forEach(s => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = report.get(s.selectedCandidatePairId);
    });
    if (!pair) report.forEach(s => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
    if (pair) {
      const local = report.get(pair.localCandidateId);
      const remote = report.get(pair.remoteCandidateId);
      const relay = (local && local.candidateType === 'relay') || (remote && remote.candidateType === 'relay');
      out.route = relay ? 'relay' : 'direct';
      if (pair.currentRoundTripTime != null) out.rtt = Math.round(pair.currentRoundTripTime * 1000);
    }
    report.forEach(s => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') {
        out.bytes = s.bytesReceived || 0;
        const lost = s.packetsLost || 0, got = s.packetsReceived || 0;
        out.lossPct = got + lost ? Math.round((lost / (got + lost)) * 1000) / 10 : 0;
        if (s.frameWidth) out.res = `${s.frameWidth}×${s.frameHeight}`;
      }
    });
    if (prev && prev.bytes && out.bytes >= prev.bytes) {
      out.kbps = Math.round(((out.bytes - prev.bytes) * 8) / (out.at - prev.at));
    }
    return out;
  }

  // Keep the screen awake while the page is visible.
  function keepAwake() {
    if (!('wakeLock' in navigator)) return;
    const request = () => navigator.wakeLock.request('screen').catch(() => {});
    request();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') request();
    });
  }

  return {
    KEYS, DEFAULT_CALIB, DEFAULT_SETTINGS, params,
    load, save, room, newRoomCode, headId, classId, classCode, settings, iceConfig, sharedRelay, backoff, toEmbedUrl, playVideo, callStats, keepAwake,
  };
})();
