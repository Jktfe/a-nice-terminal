#!/usr/bin/env bun
/**
 * ant-cli-grant — caller_grants CLI verbs (slice 4/4 of caller_grants).
 *
 * JWPK msg_hf8ziydn4r + msg_zmqhwh5tpx (2026-05-19).
 *
 * Standalone-runnable today; wire into ant-cli.mjs dispatch once the
 * V3 → V4 CLI swap from abstract-kindling-fiddle.md Phase 5/6 happens.
 *
 * Verbs:
 *   ant granthuman   --pid PID --for DURATION [--password]
 *     Grant @you to PID for DURATION (e.g. 15m, 1h). Optional --password
 *     prompts for the demo-login password before issuing.
 *
 *   ant grantagent   --pid PID --handle @evolveantfoo [--tmux SESSION]
 *     Grant agent handle to PID. No expiry; auto-revokes on PID exit.
 *
 *   ant revokegrant  --id GRANT_ID
 *     Revoke an active grant by id.
 *
 *   ant listgrants
 *     List active grants (for audit).
 *
 * Reads ANT_ADMIN_TOKEN from ~/.ant/secrets.env (chmod 600 — already
 * banked discipline: project_demo_login_secrets_location_2026_05_18.md).
 */

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync as fsReadFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const SERVER_URL = process.env.ANT_SERVER_URL ?? 'http://localhost:6174';

function loadAdminToken() {
  const envToken = process.env.ANT_ADMIN_TOKEN;
  if (envToken && envToken.length > 0) return envToken;
  const secretsPath = join(homedir(), '.ant', 'secrets.env');
  if (!existsSync(secretsPath)) {
    throw new Error(`ANT_ADMIN_TOKEN not set and ~/.ant/secrets.env not found.`);
  }
  const lines = readFileSync(secretsPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('ANT_ADMIN_TOKEN=')) {
      return trimmed.slice('ANT_ADMIN_TOKEN='.length).replace(/^"|"$/g, '');
    }
  }
  throw new Error(`ANT_ADMIN_TOKEN not found in ~/.ant/secrets.env.`);
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return flags;
}

function parseDurationToMs(raw) {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(raw.trim());
  if (!match) throw new Error(`bad duration "${raw}" — use 15m / 1h / 2d`);
  const n = Number(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  return n * (unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
}

function pidStartFor(pid) {
  // Best-effort: /proc/{pid}/stat field 22 is the start time in clock ticks
  // since boot. On macOS /proc doesn't exist, so fall back to `ps -p pid -o lstart=`.
  try {
    if (process.platform === 'linux') {
      const stat = fsReadFileSync(`/proc/${pid}/stat`, 'utf8');
      // field 22 in the stat line — Mac doesn't have this
      const fields = stat.split(' ');
      return fields[21] ?? `linux-${Date.now()}`;
    }
    // macOS fallback
    const { execSync } = require('node:child_process');
    const out = execSync(`ps -p ${pid} -o lstart=`, { encoding: 'utf8' }).trim();
    return out || `mac-${Date.now()}`;
  } catch {
    return `unknown-${Date.now()}`;
  }
}

async function postGrant(body) {
  const token = loadAdminToken();
  const res = await fetch(`${SERVER_URL}/api/admin/grants`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /api/admin/grants → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function deleteGrant(id) {
  const token = loadAdminToken();
  const url = `${SERVER_URL}/api/admin/grants?id=${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function listGrants() {
  const token = loadAdminToken();
  const res = await fetch(`${SERVER_URL}/api/admin/grants`, {
    headers: { 'authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function promptPassword(prompt) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const answer = await rl.question(prompt);
  rl.close();
  return answer;
}

async function main() {
  const [, , verb, ...rest] = process.argv;
  const flags = parseFlags(rest);
  try {
    if (verb === 'granthuman') {
      if (!flags.pid) throw new Error('--pid required');
      if (!flags.for) throw new Error('--for required (e.g. 15m, 1h)');
      const pid = Math.floor(Number(flags.pid));
      const expiresInMs = parseDurationToMs(String(flags.for));
      const pid_start = pidStartFor(pid);
      let passwordVerified = false;
      if (flags.password) {
        const entered = await promptPassword('Demo-login password: ');
        const expected = process.env.ANT_DEMO_PASSWORD ?? '';
        if (entered !== expected) throw new Error('password mismatch');
        passwordVerified = true;
      }
      const out = await postGrant({
        kind: 'human', pid, pid_start, expires_in_ms: expiresInMs,
        password_verified: passwordVerified, granted_by_handle: '@you'
      });
      console.log(`Granted @you to PID ${pid} for ${flags.for}. id=${out.grant.id}`);
    } else if (verb === 'grantagent') {
      if (!flags.pid) throw new Error('--pid required');
      if (!flags.handle) throw new Error('--handle required (e.g. @evolveantfoo)');
      const pid = Math.floor(Number(flags.pid));
      const pid_start = pidStartFor(pid);
      const out = await postGrant({
        kind: 'agent', pid, pid_start, handle: String(flags.handle),
        tmux_session_id: flags.tmux ? String(flags.tmux) : null,
        granted_by_handle: '@you'
      });
      console.log(`Granted ${out.grant.handle} to PID ${pid}. id=${out.grant.id}`);
    } else if (verb === 'revokegrant') {
      if (!flags.id) throw new Error('--id required');
      const out = await deleteGrant(String(flags.id));
      console.log(`Revoked: ${out.revoked}`);
    } else if (verb === 'listgrants') {
      const out = await listGrants();
      console.log(JSON.stringify(out.grants, null, 2));
    } else {
      console.error('Usage: ant {granthuman|grantagent|revokegrant|listgrants} [...flags]');
      console.error('  granthuman   --pid PID --for 15m [--password]');
      console.error('  grantagent   --pid PID --handle @evolveantfoo [--tmux SESSION]');
      console.error('  revokegrant  --id GRANT_ID');
      console.error('  listgrants');
      process.exit(2);
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
