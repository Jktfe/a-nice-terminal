import { describe, it, expect } from 'vitest';
import { getIdentityDb } from './db';

function now() {
  return new Date().toISOString();
}

function logMeasurement(id: string, metric: string, valueMs: number, method: string, owner: string) {
  console.log(JSON.stringify({
    measurement_id: id,
    metric,
    value_ms: Math.round(valueMs * 100) / 100,
    method,
    owner,
    timestamp: now()
  }));
}

/**
 * Bumped N from 20 to 100 so p95 and p99 are distinct samples (with N=20 they
 * both resolve to the max sample). Matches probe N-bump fix kimi claimed in
 * agentLatencyProbe.test.ts but applied independently here so the L3 ledger
 * doesn't inherit the bug.
 */
function probe(label: string, fn: (i: number) => void, N = 100) {
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const start = performance.now();
    fn(i);
    const elapsed = performance.now() - start;
    times.push(elapsed);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(N * 0.5)];
  const p95 = times[Math.floor(N * 0.95)];
  const p99 = times[Math.floor(N * 0.99)];
  return { p50, p95, p99, samples: times };
}

describe('T2/L3 Agent Round-Trip Latency Probes', () => {
  it('measures send→DB-visible round-trip via direct INSERT (no HTTP)', () => {
    const db = getIdentityDb();
    const ts = Date.now();
    const roomId = `rt-probe-room-${ts}`;

    db.prepare(`INSERT INTO chat_rooms (id, name, summary, attention_state, last_update, when_it_was_created, who_created_it, creation_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(roomId, 'rt-probe', '', 'ready', now(), now(), '@probe', Date.now());

    const p = probe('send_db_visible', (i) => {
      const id = `rt1-${ts}-${i}`;
      // Simulates the post-handler path: insert + immediately-visible read
      db.prepare(`INSERT INTO chat_messages (id, room_id, author_handle, author_display_name, kind, body, posted_at, post_order)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, roomId, '@probe', '@probe', 'system', 'rt probe', now(), i);
      // Reader: SELECT that mimics what /api/chat-rooms/[roomId]/messages returns
      db.prepare(`SELECT id, room_id, author_handle, body, posted_at FROM chat_messages WHERE room_id = ? ORDER BY post_order DESC LIMIT 50`).all(roomId);
    });

    logMeasurement('t2-l3-send-db-visible', 'send_to_target_visible_p95', p.p95, 'db_insert_then_list_select_p95', '@speedyclaude');
    console.log('  send→DB-visible p50=', p.p50.toFixed(2), 'p95=', p.p95.toFixed(2), 'p99=', p.p99.toFixed(2));

    db.prepare(`DELETE FROM chat_messages WHERE room_id = ?`).run(roomId);
    db.prepare(`DELETE FROM chat_rooms WHERE id = ?`).run(roomId);
  });

  it('measures the list-after-insert as room grows (50 / 500 prior messages)', () => {
    const db = getIdentityDb();
    const ts = Date.now();
    const roomId = `rt-growth-room-${ts}`;

    db.prepare(`INSERT INTO chat_rooms (id, name, summary, attention_state, last_update, when_it_was_created, who_created_it, creation_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(roomId, 'rt-growth', '', 'ready', now(), now(), '@probe', Date.now());

    // Seed 50 messages
    for (let s = 0; s < 50; s++) {
      db.prepare(`INSERT INTO chat_messages (id, room_id, author_handle, author_display_name, kind, body, posted_at, post_order)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`seed-${ts}-${s}`, roomId, '@probe', '@probe', 'system', 'seed', now(), s);
    }

    const p50 = probe('list_after_insert_50', (i) => {
      const id = `rt50-${ts}-${i}`;
      db.prepare(`INSERT INTO chat_messages (id, room_id, author_handle, author_display_name, kind, body, posted_at, post_order)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, roomId, '@probe', '@probe', 'system', 'rt probe', now(), 50 + i);
      db.prepare(`SELECT id, room_id, author_handle, body, posted_at FROM chat_messages WHERE room_id = ? ORDER BY post_order DESC LIMIT 50`).all(roomId);
    });

    logMeasurement('t2-l3-list-after-insert-50', 'list_after_insert_room_size_50_p95', p50.p95, 'db_insert_then_list_50_select_p95', '@speedyclaude');
    console.log('  list-after-insert (50 prior) p50=', p50.p50.toFixed(2), 'p95=', p50.p95.toFixed(2), 'p99=', p50.p99.toFixed(2));

    // Grow to 500 then re-measure
    for (let s = 0; s < 450; s++) {
      db.prepare(`INSERT INTO chat_messages (id, room_id, author_handle, author_display_name, kind, body, posted_at, post_order)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`seed500-${ts}-${s}`, roomId, '@probe', '@probe', 'system', 'seed', now(), 200 + s);
    }

    const p500 = probe('list_after_insert_500', (i) => {
      const id = `rt500-${ts}-${i}`;
      db.prepare(`INSERT INTO chat_messages (id, room_id, author_handle, author_display_name, kind, body, posted_at, post_order)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, roomId, '@probe', '@probe', 'system', 'rt probe', now(), 1000 + i);
      db.prepare(`SELECT id, room_id, author_handle, body, posted_at FROM chat_messages WHERE room_id = ? ORDER BY post_order DESC LIMIT 50`).all(roomId);
    });

    logMeasurement('t2-l3-list-after-insert-500', 'list_after_insert_room_size_500_p95', p500.p95, 'db_insert_then_list_500_select_p95', '@speedyclaude');
    console.log('  list-after-insert (500 prior) p50=', p500.p50.toFixed(2), 'p95=', p500.p95.toFixed(2), 'p99=', p500.p99.toFixed(2));

    db.prepare(`DELETE FROM chat_messages WHERE room_id = ?`).run(roomId);
    db.prepare(`DELETE FROM chat_rooms WHERE id = ?`).run(roomId);
  });
});
