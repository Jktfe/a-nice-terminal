#!/usr/bin/env node
/**
 * probe-claude-context-fill — reads a Claude Code session JSONL transcript,
 * computes the rolling context-window fill (0..1), and POSTs it to the v4
 * server's /api/terminals/[id]/context-fill endpoint so the AgentContextChip
 * surfaces a real percentage. Closes the loop on JWPK msg_vz19pvkajk
 * 2026-05-19 + commit 80af28d (schema + write endpoint + freshness gate).
 *
 * Context-fill formula: max(per-message context size) over the trailing
 * window of the transcript. Per-message context size =
 *   input_tokens
 * + cache_read_input_tokens
 * + cache_creation_input_tokens
 *   (output_tokens excluded — the model's own response isn't part of the
 *   inbound context for the NEXT turn; cache stays with the session)
 *
 * Model limits: Sonnet 4.x / Opus 4.x / Haiku 4.x all default to 200k
 * tokens of context. Newer 1M-context modes are gated on a beta flag —
 * default to 200k unless --context-window overrides.
 *
 * Usage:
 *   probe-claude-context-fill.mjs --jsonl <path> --terminal <id> [--server <url>] [--context-window <N>] [--dry-run]
 *
 * Auth: reads ANT_ADMIN_TOKEN from env or ~/.ant/secrets.env.
 * Server URL default: env ANT_SERVER_URL || http://localhost:6174.
 */

import fs from 'node:fs';
import readline from 'node:readline';

const DEFAULT_CONTEXT_WINDOW = 200_000;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const eq = key.indexOf('=');
    if (eq !== -1) {
      flags[key.slice(0, eq)] = key.slice(eq + 1);
    } else {
      const next = argv[i + 1];
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

function require_(flags, key) {
  if (!flags[key]) {
    console.error(`Missing required flag: --${key}`);
    process.exit(2);
  }
  return flags[key];
}

function readAdminTokenFromSecrets() {
  // Allow ANT_ADMIN_TOKEN env override; otherwise read from ~/.ant/secrets.env
  if (process.env.ANT_ADMIN_TOKEN) return process.env.ANT_ADMIN_TOKEN;
  const path = `${process.env.HOME}/.ant/secrets.env`;
  if (!fs.existsSync(path)) return null;
  const content = fs.readFileSync(path, 'utf8');
  const match = content.match(/^ANT_ADMIN_TOKEN=(.+)$/m);
  return match ? match[1].trim() : null;
}

async function computeFillFromJsonl(jsonlPath, contextWindow) {
  if (!fs.existsSync(jsonlPath)) {
    throw new Error(`JSONL not found: ${jsonlPath}`);
  }
  const stream = fs.createReadStream(jsonlPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let maxContextTokens = 0;
  let messageCount = 0;
  for await (const line of rl) {
    if (line.length === 0) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    const usage = parsed?.message?.usage;
    if (!usage) continue;
    const inputTokens = Number(usage.input_tokens) || 0;
    const cacheRead = Number(usage.cache_read_input_tokens) || 0;
    const cacheCreation = Number(usage.cache_creation_input_tokens) || 0;
    const contextTokens = inputTokens + cacheRead + cacheCreation;
    if (contextTokens > maxContextTokens) maxContextTokens = contextTokens;
    messageCount++;
  }
  const fill = Math.min(1, maxContextTokens / contextWindow);
  return { fill, maxContextTokens, messageCount };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help || flags.h) {
    console.log('Usage: probe-claude-context-fill.mjs --jsonl <path> --terminal <id> [--server <url>] [--context-window <N>] [--dry-run]');
    process.exit(0);
  }
  const jsonl = require_(flags, 'jsonl');
  const terminalId = require_(flags, 'terminal');
  const serverUrl = flags.server || process.env.ANT_SERVER_URL || 'http://localhost:6174';
  const contextWindow = Number(flags['context-window']) || DEFAULT_CONTEXT_WINDOW;
  const dryRun = Boolean(flags['dry-run']);

  const { fill, maxContextTokens, messageCount } = await computeFillFromJsonl(jsonl, contextWindow);
  const pct = (fill * 100).toFixed(1);
  console.log(`[probe] ${messageCount} messages scanned, max context = ${maxContextTokens.toLocaleString()} tokens / ${contextWindow.toLocaleString()} window → ${pct}%`);

  if (dryRun) {
    console.log('[probe] --dry-run; not POSTing');
    return;
  }

  const adminToken = readAdminTokenFromSecrets();
  if (!adminToken) {
    console.error('[probe] no ANT_ADMIN_TOKEN in env or ~/.ant/secrets.env');
    process.exit(3);
  }

  const url = `${serverUrl}/api/terminals/${encodeURIComponent(terminalId)}/context-fill`;
  const body = JSON.stringify({ fill, source: 'claude-statusline-jsonl' });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${adminToken}`
    },
    body
  });
  if (!res.ok) {
    console.error(`[probe] POST ${url} → HTTP ${res.status}`);
    const text = await res.text();
    console.error(text.slice(0, 500));
    process.exit(4);
  }
  console.log(`[probe] POST 200 — terminal ${terminalId} → ${pct}%`);
}

main().catch((err) => {
  console.error('[probe] error:', err.message);
  process.exit(1);
});
