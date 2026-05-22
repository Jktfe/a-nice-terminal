#!/usr/bin/env node
/**
 * ack-budget-report — Speed Pact M-Measure A3 live measurement.
 *
 * Walks the live chat_messages history for the Speed Pact room and
 * reports each agent's compliance with the 5s ACK rule:
 *   - addressed count (how many times an @-mention pointed at them)
 *   - acked-within-5s count
 *   - p50 / p95 / p99 ack-delay
 *
 * The sibling vitest file (src/lib/server/ackBudgetProbe.test.ts) holds
 * the typed unit version that runs in a hermetic test DB. This script
 * is the live-DB sibling so JWPK / agents can run it on demand:
 *
 *   node scripts/ack-budget-report.mjs                      # default room
 *   node scripts/ack-budget-report.mjs --room ROOM_ID       # widen
 *   node scripts/ack-budget-report.mjs --json               # machine-readable
 *
 * Read-only. Does NOT block / enforce. JWPK ratifies threshold separately.
 */

import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const ACK_BUDGET_MS = 5000;
const DEFAULT_ROOM = 'orsz2321qb';
const PACT_AGENTS = ['@speedyclaude', '@speedycodex', '@speedykimi'];

function parseArgs(argv) {
  const out = { room: DEFAULT_ROOM, json: false, dbPath: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--room') out.room = argv[++i];
    else if (arg === '--json') out.json = true;
    else if (arg === '--db') out.dbPath = argv[++i];
  }
  return out;
}

// Mirror the canonical mention parser at src/lib/chat/mentionRouting.ts.
// Conservative bare-mention shape: leading whitespace or start, `@`, then
// handle chars (alnum + - + _), trailing word boundary. Matches @speedyclaude
// but not [@speedyclaude] (bracketed = silent per banked feedback).
function listBareMentionHandles(body) {
  if (typeof body !== 'string') return [];
  const handles = new Set();
  const matches = body.matchAll(/(?:^|\s)@([A-Za-z0-9_-]+)/g);
  for (const m of matches) {
    if (m[1]) handles.add(`@${m[1]}`);
  }
  return [...handles];
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? null;
}

function main() {
  const args = parseArgs(process.argv);
  const dbPath = args.dbPath ?? resolve(homedir(), '.ant', 'fresh-ant.db');
  const db = new Database(dbPath, { readonly: true });

  const messages = db
    .prepare(
      `SELECT id, author_handle, body, posted_at, post_order
       FROM chat_messages
       WHERE room_id = ? AND deleted_at_ms IS NULL
       ORDER BY post_order ASC`
    )
    .all(args.room);

  if (messages.length === 0) {
    console.error(`No messages in room ${args.room} (db=${dbPath}).`);
    process.exit(1);
  }

  const records = {};
  for (const agent of PACT_AGENTS) records[agent] = { addressed: 0, ackedWithin5s: 0, ackDelaysMs: [] };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg) continue;
    const mentions = listBareMentionHandles(msg.body);
    const addressed = mentions.filter((m) => PACT_AGENTS.includes(m) && m !== msg.author_handle);
    if (addressed.length === 0) continue;
    const msgTs = new Date(msg.posted_at).getTime();
    if (!Number.isFinite(msgTs)) continue;

    for (const target of addressed) {
      const rec = records[target];
      rec.addressed++;
      for (let j = i + 1; j < messages.length; j++) {
        const next = messages[j];
        if (!next || next.author_handle !== target) continue;
        const nextTs = new Date(next.posted_at).getTime();
        if (!Number.isFinite(nextTs)) break;
        const deltaMs = nextTs - msgTs;
        if (deltaMs >= 0) {
          rec.ackDelaysMs.push(deltaMs);
          if (deltaMs <= ACK_BUDGET_MS) rec.ackedWithin5s++;
        }
        break;
      }
    }
  }

  const out = {
    room: args.room,
    ack_budget_ms: ACK_BUDGET_MS,
    total_messages: messages.length,
    agents: {}
  };
  for (const agent of PACT_AGENTS) {
    const r = records[agent];
    const sorted = [...r.ackDelaysMs].sort((a, b) => a - b);
    out.agents[agent] = {
      addressed: r.addressed,
      acked_within_5s: r.ackedWithin5s,
      compliance_rate_pct: r.addressed > 0 ? Math.round((r.ackedWithin5s / r.addressed) * 100) : null,
      p50_ack_ms: percentile(sorted, 0.5),
      p95_ack_ms: percentile(sorted, 0.95),
      p99_ack_ms: percentile(sorted, 0.99)
    };
  }

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`--- ACK Budget Report (room=${args.room}, n=${messages.length} msgs, budget=${ACK_BUDGET_MS}ms) ---`);
    for (const agent of PACT_AGENTS) {
      const a = out.agents[agent];
      const rate = a.compliance_rate_pct !== null ? `${a.compliance_rate_pct}%` : 'n/a';
      console.log(
        `${agent.padEnd(15)}  addressed=${String(a.addressed).padStart(3)}  ` +
          `acked-≤5s=${String(a.acked_within_5s).padStart(3)} (${rate.padStart(4)})  ` +
          `p50=${a.p50_ack_ms ?? 'n/a'}ms  p95=${a.p95_ack_ms ?? 'n/a'}ms  p99=${a.p99_ack_ms ?? 'n/a'}ms`
      );
    }
  }

  db.close();
}

main();
