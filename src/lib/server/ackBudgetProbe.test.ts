import { describe, it, expect } from 'vitest';
import { getIdentityDb } from './db';
import { listBareMentionHandles } from '../chat/mentionRouting';

/**
 * ACK Budget Probe — Speed Pact v0.3 M-Measure A3 scaffold.
 *
 * The 5s rule: when agent X is @-mentioned in a room, the next message
 * from X in that room should arrive within 5 seconds. Even a "got it,
 * looking" — perceived speed beats actual completion. The scaffold is
 * read-only: it measures compliance against existing history, it
 * doesn't BLOCK anything.
 *
 * Scope: orsz2321qb (Speed Pact room), the 3 speed-pact agents.
 * Easily widened later by adding rooms / handles to the constants.
 *
 * Reports: for each agent, addressed-count + acked-within-5s count
 * + median delay-to-ack. Writes the result as JSON to stdout for
 * downstream ingestion by the speed ledger.
 */

const ACK_BUDGET_MS = 5000;
const PACT_ROOM_ID = 'orsz2321qb';
const PACT_AGENTS = ['@speedyclaude', '@speedycodex', '@speedykimi'] as const;

type MessageRow = {
  id: string;
  author_handle: string;
  body: string;
  posted_at: string;
  post_order: number;
};

type AckRecord = {
  addressed: number;
  ackedWithin5s: number;
  ackDelaysMs: number[];
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? null;
}

describe('ACK Budget Probe — Speed Pact 5s perceived-speed rule', () => {
  it('measures compliance across all 3 speed-pact agents in orsz2321qb', () => {
    const db = getIdentityDb();

    const messages = db
      .prepare(
        `SELECT id, author_handle, body, posted_at, post_order
         FROM chat_messages
         WHERE room_id = ? AND deleted_at_ms IS NULL
         ORDER BY post_order ASC`
      )
      .all(PACT_ROOM_ID) as MessageRow[];

    // Skip if no data (e.g. probe runs in a fresh test DB)
    if (messages.length === 0) {
      console.log('ack-budget: room', PACT_ROOM_ID, 'has no messages — skipping');
      expect(messages).toEqual([]);
      return;
    }

    const records: Record<string, AckRecord> = {};
    for (const agent of PACT_AGENTS) {
      records[agent] = { addressed: 0, ackedWithin5s: 0, ackDelaysMs: [] };
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      const mentions = listBareMentionHandles(msg.body);
      const addressedAgents = mentions.filter((m): m is (typeof PACT_AGENTS)[number] =>
        (PACT_AGENTS as readonly string[]).includes(m)
      );
      if (addressedAgents.length === 0) continue;
      // Don't count self-mentions (agent X writing "...as @X said earlier...")
      const realAddressees = addressedAgents.filter((target) => target !== msg.author_handle);
      if (realAddressees.length === 0) continue;

      const msgTs = new Date(msg.posted_at).getTime();
      if (!Number.isFinite(msgTs)) continue;

      for (const target of realAddressees) {
        const record = records[target];
        if (!record) continue;
        record.addressed++;
        // Find the next message from the target in this room
        for (let j = i + 1; j < messages.length; j++) {
          const next = messages[j];
          if (!next) continue;
          if (next.author_handle !== target) continue;
          const nextTs = new Date(next.posted_at).getTime();
          if (!Number.isFinite(nextTs)) break;
          const deltaMs = nextTs - msgTs;
          if (deltaMs >= 0) {
            record.ackDelaysMs.push(deltaMs);
            if (deltaMs <= ACK_BUDGET_MS) record.ackedWithin5s++;
          }
          break;
        }
      }
    }

    // Report — JSON line per agent for ledger ingestion + human-readable summary
    console.log('--- ACK Budget Probe (5s rule, room orsz2321qb) ---');
    for (const agent of PACT_AGENTS) {
      const r = records[agent];
      if (!r) continue;
      const sorted = [...r.ackDelaysMs].sort((a, b) => a - b);
      const p50 = percentile(sorted, 0.5);
      const p95 = percentile(sorted, 0.95);
      const p99 = percentile(sorted, 0.99);
      const complianceRate = r.addressed > 0 ? (r.ackedWithin5s / r.addressed) * 100 : null;
      console.log(
        JSON.stringify({
          measurement_id: `t2-ackbudget-${agent.replace('@', '')}`,
          metric: 'ack_budget_compliance_5s',
          agent,
          addressed: r.addressed,
          acked_within_5s: r.ackedWithin5s,
          compliance_rate_pct: complianceRate !== null ? Math.round(complianceRate) : null,
          p50_ack_ms: p50,
          p95_ack_ms: p95,
          p99_ack_ms: p99,
          timestamp: new Date().toISOString()
        })
      );
      console.log(
        `  ${agent}: addressed=${r.addressed} acked-within-5s=${r.ackedWithin5s} ` +
          `(${complianceRate !== null ? complianceRate.toFixed(0) : 'n/a'}%)  ` +
          `p50=${p50 ?? 'n/a'}ms  p95=${p95 ?? 'n/a'}ms  p99=${p99 ?? 'n/a'}ms`
      );
    }

    // Acceptance: the scaffold ran across all 3 agents and produced numbers.
    // Compliance enforcement (failing if < some threshold) is intentionally
    // not wired here — this is the SCAFFOLD acceptance, not the enforcement
    // acceptance. JWPK ratifies threshold separately.
    expect(Object.keys(records)).toEqual([...PACT_AGENTS]);
    for (const agent of PACT_AGENTS) {
      expect(records[agent]).toBeDefined();
    }
  });
});
