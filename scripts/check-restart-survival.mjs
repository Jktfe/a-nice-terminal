#!/usr/bin/env node
// check-restart-survival — m5.4 Phase B live process-manager restart probe.
// Captures rooms/members/messages counts via :6174 API before launchctl
// kickstart, waits for the service to recover, and asserts the same counts
// survive. Belt-and-braces operational proof that complements the Phase A
// integration-test invariant (close+reopen db survives).
import { spawn, spawnSync } from 'node:child_process';

const URL_BASE = process.env.ANT_FRESH_URL ?? 'http://127.0.0.1:6174';
const SERVICE = process.env.ANT_FRESH_SERVICE ?? 'com.ant.fresh';
const HEALTHCHECK_PATH = '/api/chat-rooms';
const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_TIMEOUT_MS = 30_000;

async function fetchJson(path) {
  const res = await fetch(`${URL_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function captureState() {
  const roomsBody = await fetchJson('/api/chat-rooms');
  const rooms = roomsBody.chatRooms ?? [];
  let memberTotal = 0, messageTotal = 0;
  for (const room of rooms) {
    memberTotal += room.members?.length ?? 0;
    try {
      const msgs = await fetchJson(`/api/chat-rooms/${room.id}/messages`);
      messageTotal += msgs.messages?.length ?? 0;
    } catch { /* unreachable room — count as zero */ }
  }
  return { rooms: rooms.length, members: memberTotal, messages: messageTotal };
}

async function waitHealthy(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${URL_BASE}${HEALTHCHECK_PATH}`);
      if (res.ok) return true;
    } catch { /* expected during restart window */ }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

function uid() {
  const r = spawnSync('id', ['-u'], { encoding: 'utf8' });
  return (r.stdout ?? '').trim();
}

async function kickstart() {
  return new Promise((resolve, reject) => {
    const proc = spawn('launchctl', ['kickstart', '-k', `gui/${uid()}/${SERVICE}`],
      { stdio: 'inherit' });
    proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`kickstart exit ${code}`)));
  });
}

export async function runRestartProbe({ writeOut = console.log } = {}) {
  writeOut(`probe target: ${URL_BASE} via service ${SERVICE}`);
  const before = await captureState();
  writeOut(`before: rooms=${before.rooms} members=${before.members} messages=${before.messages}`);
  await kickstart();
  writeOut('kickstart issued; waiting for :6174 to recover...');
  const ok = await waitHealthy(Date.now() + HEALTH_TIMEOUT_MS);
  if (!ok) throw new Error(`service did not recover within ${HEALTH_TIMEOUT_MS}ms`);
  const after = await captureState();
  writeOut(`after:  rooms=${after.rooms} members=${after.members} messages=${after.messages}`);
  const match = before.rooms === after.rooms && before.members === after.members && before.messages === after.messages;
  if (!match) throw new Error(`drift detected: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  writeOut('SURVIVAL OK — counts match across restart');
  return { before, after };
}

const isEntry = typeof process !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  runRestartProbe().catch((err) => { process.stderr.write(`${err.message}\n`); process.exit(1); });
}
