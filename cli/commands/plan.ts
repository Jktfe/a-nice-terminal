// `ant plan list` — enumerate plan_id::session_id pairs the server knows about.
// `ant plan show <plan_id> [--session <id>] [--limit N]` — fetch events for one plan.
//
// Wraps GET /api/plans (list) and GET /api/plan?plan_id=...&session_id=... (events).
// The /plan UI already does the same; this is the CLI counterpart so a remote agent
// or a scripted check can read plan progress without opening a browser.

import { api } from '../lib/api.js';

interface PlanRef {
  session_id: string;
  plan_id: string;
  event_count: number;
  last_ts_ms?: number;
}

interface PlanEvent {
  id: string;
  session_id: string;
  ts_ms: number;
  kind: string;
  text: string;
  payload: Record<string, unknown>;
}

const STATUS_COLOURS: Record<string, string> = {
  passing: '\x1b[32m',
  active:  '\x1b[33m',
  planned: '\x1b[37m',
  blocked: '\x1b[31m',
};

function colourStatus(s: string): string {
  return `${STATUS_COLOURS[s] || ''}${s}\x1b[0m`;
}

function slug(value: string | undefined | null): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function plan(args: string[], flags: any, ctx: any) {
  const sub = args[0];

  if (!sub || sub === 'list') {
    const limit = flags.limit ? Number(flags.limit) : 50;
    const data = await api.get(ctx, `/api/plans?limit=${limit}`);
    const plans: PlanRef[] = data.plans || [];
    if (ctx.json) { console.log(JSON.stringify(plans, null, 2)); return; }
    if (!plans.length) { console.log('No plans yet — emit plan_milestone or plan_test_status events to populate.'); return; }
    console.log(`${plans.length} plan${plans.length === 1 ? '' : 's'}:`);
    for (const p of plans) {
      const when = p.last_ts_ms ? new Date(p.last_ts_ms).toISOString().slice(0, 16).replace('T', ' ') : '          ';
      console.log(`  ${p.plan_id.padEnd(32)}  ${p.session_id.padEnd(36)}  ${String(p.event_count).padStart(4)} events  last ${when}`);
    }
    return;
  }

  if (sub === 'show') {
    const planId = args[1];
    if (!planId) {
      console.error('Usage: ant plan show <plan_id> [--session <id>] [--limit N]');
      process.exit(1);
    }
    const sessionId = typeof flags.session === 'string' ? flags.session : '';
    const limit = flags.limit ? Number(flags.limit) : 1000;
    const params = new URLSearchParams({ plan_id: planId, limit: String(limit) });
    if (sessionId) params.set('session_id', sessionId);
    const data = await api.get(ctx, `/api/plan?${params.toString()}`);
    const events: PlanEvent[] = data.events || [];
    if (ctx.json) { console.log(JSON.stringify(data)); return; }
    if (!events.length) { console.log(`No events for plan ${planId}${sessionId ? ` in session ${sessionId}` : ''}.`); return; }

    // Group by milestone, taking latest status per identity. Identity matches the
    // server projector (src/lib/server/projector/plan-view.ts:planEventIdentity):
    //   milestone:<milestone_id|slug(title)>
    //   test:<milestone_id>:<slug(title)|o<order>>
    const milestoneStatus = new Map<string, { status: string; title?: string; ts_ms: number }>();
    const testStatus = new Map<string, { status: string; title?: string; milestone_id?: string; ts_ms: number }>();
    for (const ev of events) {
      const p = ev.payload as any;
      if (ev.kind === 'plan_milestone') {
        const mId = p?.milestone_id || p?.id || slug(p?.title);
        if (!mId) continue;
        const prev = milestoneStatus.get(mId);
        if (!prev || ev.ts_ms > prev.ts_ms) {
          milestoneStatus.set(mId, { status: p.status || 'planned', title: p.title, ts_ms: ev.ts_ms });
        }
      } else if (ev.kind === 'plan_test' || ev.kind === 'plan_test_status') {
        const milestoneId = p?.milestone_id || p?.parent_id || '';
        const tailId = slug(p?.title) || (p?.order != null ? `o${p.order}` : '');
        if (!milestoneId || !tailId) continue;
        const tId = `${milestoneId}/${tailId}`;
        const prev = testStatus.get(tId);
        if (!prev || ev.ts_ms > prev.ts_ms) {
          testStatus.set(tId, {
            status: p.status || 'planned',
            title: p.title,
            milestone_id: milestoneId,
            ts_ms: ev.ts_ms,
          });
        }
      }
    }

    console.log(`Plan ${data.plan_id} (session ${data.session_id}) — ${events.length} events, ${milestoneStatus.size} milestones, ${testStatus.size} tests`);
    console.log('');

    const sortedMilestones = [...milestoneStatus.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [mId, m] of sortedMilestones) {
      console.log(`  ${colourStatus(m.status.padEnd(8))}  ${mId}${m.title ? `  ${m.title}` : ''}`);
      const tests = [...testStatus.entries()]
        .filter(([, t]) => t.milestone_id === mId)
        .sort(([a], [b]) => a.localeCompare(b));
      for (const [tId, t] of tests) {
        console.log(`    ${colourStatus(t.status.padEnd(8))}  ${tId}${t.title ? `  ${t.title.slice(0, 60)}` : ''}`);
      }
    }
    return;
  }

  console.error('Usage: ant plan <list|show>');
  console.error('  ant plan list [--limit N]');
  console.error('  ant plan show <plan_id> [--session <id>] [--limit N]');
  process.exit(1);
}
