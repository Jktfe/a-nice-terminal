// Append a status-update event for an existing plan_test or plan_milestone.
//
// The Plan View projector dedupes events by (kind, milestone_id, slug(title))
// keeping the latest by ts_ms — so emitting a fresh event with all the same
// payload fields plus a new `status` supersedes the prior status without
// mutating any existing run_events row (the audit log stays intact).
//
// Usage:
//   tsx scripts/update-plan-status.ts \
//     --plan ant-delivery-2026-05-05 \
//     --milestone M1 \
//     --status active \
//     [--test "Capture-coverage baseline..." | --test 1]
//     [--note "started capture-coverage scripted exercise"]
//
// If --test is omitted, the milestone itself is updated.
// --test accepts either a substring match against the title or a 1-based order.

import getDb from '../src/lib/server/db.js';
import type {
  PlanEventPayload,
  PlanStatus,
} from '../src/lib/server/projector/types.js';

const VALID_STATUS: readonly PlanStatus[] = [
  'planned',
  'active',
  'blocked',
  'passing',
  'failing',
  'done',
];

type Args = {
  plan: string;
  milestone: string;
  status: PlanStatus;
  test?: string;
  note?: string;
  session?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`flag --${key} requires a value`);
    }
    out[key] = next;
    i++;
  }
  if (!out.plan) throw new Error('--plan required');
  if (!out.milestone) throw new Error('--milestone required');
  if (!out.status) throw new Error('--status required');
  if (!VALID_STATUS.includes(out.status as PlanStatus)) {
    throw new Error(`--status must be one of ${VALID_STATUS.join(', ')}`);
  }
  return {
    plan: out.plan,
    milestone: out.milestone,
    status: out.status as PlanStatus,
    test: out.test,
    note: out.note,
    session: out.session,
  };
}

const args = parseArgs(process.argv.slice(2));
const db = getDb();

type Row = {
  id: number;
  session_id: string;
  ts_ms: number;
  kind: string;
  payload: string;
};

const sessionFilter = args.session ? 'AND session_id = ?' : '';
const sessionParams = args.session ? [args.session] : [];

const targetKind = args.test ? 'plan_test' : 'plan_milestone';

const rows = db
  .prepare(
    `SELECT id, session_id, ts_ms, kind, payload
       FROM run_events
      WHERE kind = ?
        AND JSON_VALID(payload)
        AND JSON_EXTRACT(payload, '$.plan_id') = ?
        AND JSON_EXTRACT(payload, '$.milestone_id') = ?
        ${sessionFilter}
      ORDER BY ts_ms DESC`,
  )
  .all(targetKind, args.plan, args.milestone, ...sessionParams) as Row[];

if (rows.length === 0) {
  throw new Error(
    `No ${targetKind} found for plan_id=${args.plan} milestone_id=${args.milestone}`,
  );
}

let target: Row | undefined;

if (!args.test) {
  target = rows[0];
} else {
  const orderMatch = /^[0-9]+$/.test(args.test) ? Number(args.test) : null;
  const needle = args.test.toLowerCase();
  const seen = new Set<string>();
  // dedupe by title so we match the LATEST per identity
  const distinct = rows.filter((row) => {
    const payload = JSON.parse(row.payload) as PlanEventPayload;
    const key = (payload.title ?? '').trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (orderMatch !== null) {
    target = distinct.find((row) => {
      const payload = JSON.parse(row.payload) as PlanEventPayload;
      return payload.order === orderMatch;
    });
    if (!target) {
      throw new Error(`No plan_test with order=${orderMatch} under ${args.milestone}`);
    }
  } else {
    target = distinct.find((row) => {
      const payload = JSON.parse(row.payload) as PlanEventPayload;
      return (payload.title ?? '').toLowerCase().includes(needle);
    });
    if (!target) {
      throw new Error(
        `No plan_test under ${args.milestone} matching "${args.test}"`,
      );
    }
  }
}

const payload = JSON.parse(target.payload) as PlanEventPayload;
const previousStatus = payload.status ?? 'planned';
const nextPayload: PlanEventPayload = {
  ...payload,
  status: args.status,
};

if (args.note) {
  nextPayload.body = args.note;
}

const tsMs = Date.now();
const result = db
  .prepare(
    `INSERT INTO run_events (session_id, ts_ms, source, trust, kind, text, payload, raw_ref)
     VALUES (?, ?, 'json', 'high', ?, ?, ?, NULL)`,
  )
  .run(
    target.session_id,
    tsMs,
    target.kind,
    payload.title,
    JSON.stringify(nextPayload),
  );

console.log(
  `${target.kind} ${args.milestone}${args.test ? `/${payload.title.slice(0, 60)}` : ''} ` +
    `${previousStatus} → ${args.status} (run_event ${result.lastInsertRowid})`,
);
