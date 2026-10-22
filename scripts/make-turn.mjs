// Fetch fresh Cloudflare TURN credentials and write docs/turn.json, encrypted once per room code
// (AES-GCM, key from PBKDF2 of the room code), so only people who know a room can use the relay.
// Run by .github/workflows/turn.yml. Env: CF_TURN_KEY_ID, CF_TURN_API_TOKEN, HOLOHEAD_ROOMS (comma list).
import { writeFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const { CF_TURN_KEY_ID, CF_TURN_API_TOKEN, HOLOHEAD_ROOMS } = process.env;
const TTL = 172800; // two days, Cloudflare's limit; the workflow runs every 12 hours
const ITERATIONS = 200000;

if (!CF_TURN_KEY_ID || !CF_TURN_API_TOKEN || !HOLOHEAD_ROOMS) {
  console.error('Missing CF_TURN_KEY_ID, CF_TURN_API_TOKEN or HOLOHEAD_ROOMS.');
  process.exit(1);
}

const res = await fetch(
  `https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate-ice-servers`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL }),
  },
);
if (!res.ok) {
  console.error(`Cloudflare answered ${res.status}: ${await res.text()}`);
  process.exit(1);
}
// Keep only the TURN entry (STUN comes from Google in the pages).
const iceServers = (await res.json()).iceServers
  .filter(s => s.username)
  .map(s => ({ ...s, urls: [].concat(s.urls).filter(u => u.startsWith('turn')) }));

const b64 = bytes => Buffer.from(bytes).toString('base64');
const payload = new TextEncoder().encode(JSON.stringify({ iceServers }));

const entries = [];
for (const room of HOLOHEAD_ROOMS.split(',').map(r => r.trim().toLowerCase()).filter(Boolean)) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(room), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  entries.push({ salt: b64(salt), iv: b64(iv), iterations: ITERATIONS, data: b64(new Uint8Array(data)) });
}

const now = new Date();
writeFileSync('docs/turn.json', JSON.stringify({
  updated: now.toISOString(),
  expires: new Date(now.getTime() + TTL * 1000).toISOString(),
  entries,
}, null, 1) + '\n');
console.log(`Wrote docs/turn.json for ${entries.length} room(s), valid until ${new Date(now.getTime() + TTL * 1000).toISOString()}.`);
