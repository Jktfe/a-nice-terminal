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

function probe(label: string, fn: (i: number) => void, N = 20) {
  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const start = performance.now();
    fn(i);
    const elapsed = performance.now() - start;
    times.push(elapsed);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(N * 0.5)];
  const p95 = times[Math.floor(N * 0.95)] || times[times.length - 1];
  const p99 = times[Math.floor(N * 0.99)] || times[times.length - 1];
  return { p50, p95, p99, samples: times };
}

describe('T2 Agent-Path Latency Probes', () => {
  it('measures chat_message round-trip', () => {
    const db = getIdentityDb();
    const ts = Date.now();
    const roomId = `probe-room-${ts}`;

    // Create the room first (FK requirement)
    db.prepare(`INSERT INTO chat_rooms (id, name, summary, attention_state, last_update, when_it_was_created, who_created_it, creation_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(roomId, 'probe', '', 'ready', now(), now(), '@probe', Date.now());

    const p = probe('chat_message', (i) => {
      const id = `p1-${ts}-${i}`;
      db.prepare(`INSERT INTO chat_messages (id, room_id, author_handle, author_display_name, kind, body, posted_at, post_order)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, roomId, '@probe', '@probe', 'system', 'latency probe', now(), i);
      db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id);
    });

    logMeasurement('t2-p1-chat-send-db', 'chat_send_to_db_visible', p.p95, 'db_insert_then_select_p95', '@speedykimi');
    console.log('  chat_message p50=', p.p50.toFixed(2), 'p95=', p.p95.toFixed(2), 'p99=', p.p99.toFixed(2));

    // Cleanup
    db.prepare(`DELETE FROM chat_messages WHERE room_id = ?`).run(roomId);
    db.prepare(`DELETE FROM chat_rooms WHERE id = ?`).run(roomId);
  });

  it('measures plan_event round-trip', () => {
    const db = getIdentityDb();
    const ts = Date.now();

    const p = probe('plan_event', (i) => {
      const id = `p2-${ts}-${i}`;
      const planId = `probe-plan-${ts}`;
      db.prepare(`INSERT INTO plan_events (id, plan_id, kind, title, order_index, author_handle, author_kind, ts_millis, evidence_json)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, planId, 'plan_section', 'probe', i, '@probe', 'system', Date.now(), '[]');
      db.prepare(`SELECT * FROM plan_events WHERE id = ?`).get(id);
    });

    logMeasurement('t2-p2-plan-event-db', 'plan_event_to_db_visible', p.p95, 'db_insert_then_select_p95', '@speedykimi');
    console.log('  plan_event p50=', p.p50.toFixed(2), 'p95=', p.p95.toFixed(2), 'p99=', p.p99.toFixed(2));

    db.prepare(`DELETE FROM plan_events WHERE plan_id LIKE 'probe-plan-${ts}%'`).run();
  });

  it('measures terminal round-trip', () => {
    const db = getIdentityDb();
    const ts = Date.now();

    const p = probe('terminal', (i) => {
      const id = `p3-${ts}-${i}`;
      const name = `probe-term-${ts}-${i}`;
      db.prepare(`INSERT INTO terminals (id, pid, pid_start, name, agent_kind, expires_at, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, 0, '0', name, 'probe', Date.now() + 60000, Date.now(), Date.now());
      db.prepare(`SELECT * FROM terminals WHERE id = ?`).get(id);
    });

    logMeasurement('t2-p3-terminal-db', 'terminal_write_to_db_visible', p.p95, 'db_insert_then_select_p95', '@speedykimi');
    console.log('  terminal p50=', p.p50.toFixed(2), 'p95=', p.p95.toFixed(2), 'p99=', p.p99.toFixed(2));

    db.prepare(`DELETE FROM terminals WHERE name LIKE 'probe-term-${ts}%'`).run();
  });

  it('measures task round-trip via raw SQL', () => {
    const db = getIdentityDb();
    const ts = Date.now();

    const p = probe('task', (i) => {
      const id = `p4-${ts}-${i}`;
      db.prepare(`INSERT INTO tasks (id, subject, description, status, priority, plan_id, assigned_agent, blocks, blocked_by, evidence, notes, started_at_ms, ended_at_ms, created_at_ms, updated_at_ms)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, 'probe', null, 'pending', null, null, null, '[]', '[]', '[]', null, null, null, Date.now(), Date.now());
      db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
    });

    logMeasurement('t2-p4-task-db', 'task_create_to_db_visible', p.p95, 'db_insert_then_select_p95', '@speedykimi');
    console.log('  task p50=', p.p50.toFixed(2), 'p95=', p.p95.toFixed(2), 'p99=', p.p99.toFixed(2));

    db.prepare(`DELETE FROM tasks WHERE subject = 'probe' AND id LIKE 'p4-%'`).run();
  });
});
