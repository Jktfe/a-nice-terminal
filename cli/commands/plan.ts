// `ant plan list` — enumerate plan_id::session_id pairs the server knows about.
// `ant plan show <plan_id> [--session <id>] [--limit N]` — fetch events for one plan.
// `ant plan update <plan_id> --session <id> --milestone <id> --status <status>`
//   — append a milestone status update by PATCHing the latest matching event.
//
// Wraps GET /api/plans (list) and GET /api/plan?plan_id=...&session_id=... (events).
// The /plan UI already does the same; this is the CLI counterpart so a remote agent
// or a scripted check can read plan progress without opening a browser.

import { api } from '../lib/api.js';

interface PlanRef {
  session_id: string;
  plan_id: string;
  event_count: number;
  updated_ts_ms?: number;
  last_ts_ms?: number;
  archived?: boolean;
  status?: string;
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
  done:    '\x1b[32m',
  active:  '\x1b[33m',
  planned: '\x1b[37m',
  blocked: '\x1b[31m',
  failing: '\x1b[31m',
  archived: '\x1b[90m',
};

const PLAN_STATUSES = new Set(['planned', 'active', 'blocked', 'archived', 'passing', 'failing', 'done']);
const EVIDENCE_KINDS = new Set(['run_event', 'raw_ref', 'task', 'source_url', 'file']);

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

function flagEnabled(flags: any, dashed: string, camel: string): boolean {
  return Boolean(flags[dashed] || flags[camel]);
}

function sectionIdentity(ev: PlanEvent): string {
  const p = ev.payload as any;
  return `section:${p.acceptance_id || slug(p.title as string | undefined)}`;
}

function dedupeSections(events: PlanEvent[]): PlanEvent[] {
  const latest = new Map<string, PlanEvent>();
  for (const ev of events) {
    if (ev.kind !== 'plan_section') continue;
    const key = sectionIdentity(ev);
    const prev = latest.get(key);
    if (!prev || ev.ts_ms > prev.ts_ms) latest.set(key, ev);
  }
  return [...latest.values()].sort((a, b) => {
    const ao = Number((a.payload as any).order ?? 0);
    const bo = Number((b.payload as any).order ?? 0);
    return ao - bo || b.ts_ms - a.ts_ms;
  });
}

function milestoneIdentity(ev: PlanEvent): string {
  const p = ev.payload as any;
  return String(p.milestone_id || slug(p.title as string | undefined) || '');
}

function latestMatchingMilestone(events: PlanEvent[], milestoneId: string): PlanEvent | null {
  let latest: PlanEvent | null = null;
  for (const ev of events) {
    if (ev.kind !== 'plan_milestone') continue;
    if (milestoneIdentity(ev) !== milestoneId) continue;
    if (!latest || ev.ts_ms > latest.ts_ms) latest = ev;
  }
  return latest;
}

function parseEvidenceFlag(raw: unknown) {
  if (raw === undefined || raw === null || raw === false) return null;
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('--evidence must be kind:ref[:label]');
  }
  const separator = raw.indexOf(':');
  if (separator < 0) {
    throw new Error('--evidence must be kind:ref[:label] with kind run_event|raw_ref|task|source_url|file');
  }
  const kind = raw.slice(0, separator);
  const rest = raw.slice(separator + 1);
  let ref = rest;
  let label = '';
  if (kind !== 'source_url') {
    const labelSeparator = rest.indexOf(':');
    if (labelSeparator >= 0) {
      ref = rest.slice(0, labelSeparator);
      label = rest.slice(labelSeparator + 1);
    }
  }
  if (!EVIDENCE_KINDS.has(kind) || !ref) {
    throw new Error('--evidence must be kind:ref[:label] with kind run_event|raw_ref|task|source_url|file');
  }
  return label ? { kind, ref, label } : { kind, ref };
}

function isArchivedPlan(events: PlanEvent[]): boolean {
  return dedupeSections(events).some((ev) => (ev.payload as any).status === 'archived');
}

async function loadPlan(ctx: any, planId: string, sessionId: string, limit = 1000) {
  const params = new URLSearchParams({
    plan_id: planId,
    limit: String(limit),
    include_archived: '1',
  });
  if (sessionId) params.set('session_id', sessionId);
  return api.get(ctx, `/api/plan?${params.toString()}`);
}

async function setPlanArchived(ctx: any, flags: any, planId: string, archived: boolean) {
  const sessionId = typeof flags.session === 'string' ? flags.session : '';
  const data = await loadPlan(ctx, planId, sessionId);
  const events: PlanEvent[] = data.events || [];
  const sections = dedupeSections(events);
  const targets = archived
    ? sections.slice(0, 1)
    : sections.filter((section) => (section.payload as any).status === 'archived');
  if (!targets.length) {
    throw new Error(`Plan ${planId} has no plan_section event to ${archived ? 'archive' : 'unarchive'}`);
  }

  const results = [];
  for (const section of targets) {
    results.push(await api.patch(ctx, `/api/plan/events/${encodeURIComponent(section.id)}`, {
      status: archived ? 'archived' : 'planned',
      text: `${archived ? 'Archive' : 'Unarchive'} ${planId}`,
    }));
  }

  if (ctx.json) { console.log(JSON.stringify(results.length === 1 ? results[0] : results)); return; }
  const resolvedSessionId = data.session_id || targets[0]?.session_id || sessionId;
  console.log(`${archived ? 'Archived' : 'Unarchived'} plan ${planId}${resolvedSessionId ? ` (session ${resolvedSessionId})` : ''}.`);
}

async function updatePlanMilestone(ctx: any, flags: any, planId: string) {
  const sessionId = typeof flags.session === 'string' ? flags.session : '';
  const milestoneId = typeof flags.milestone === 'string' ? flags.milestone : '';
  const status = typeof flags.status === 'string' ? flags.status : '';
  if (!sessionId) {
    throw new Error('Usage: ant plan update <plan_id> --session <id> --milestone <id> --status <status>');
  }
  if (!milestoneId) {
    throw new Error('Usage: ant plan update <plan_id> --session <id> --milestone <id> --status <status>');
  }
  if (!status || !PLAN_STATUSES.has(status)) {
    throw new Error(`--status must be one of ${[...PLAN_STATUSES].join(', ')}`);
  }

  const data = await loadPlan(ctx, planId, sessionId);
  const events: PlanEvent[] = data.events || [];
  const target = latestMatchingMilestone(events, milestoneId);
  if (!target) {
    throw new Error(`No plan_milestone found for plan ${planId} milestone ${milestoneId}${sessionId ? ` in session ${sessionId}` : ''}`);
  }

  const existingEvidence = Array.isArray((target.payload as any).evidence)
    ? [...((target.payload as any).evidence as any[])]
    : [];
  const evidence = parseEvidenceFlag(flags.evidence);
  const body: Record<string, unknown> = { status };
  if (evidence) body.evidence = [...existingEvidence, evidence];
  if (typeof flags.note === 'string' && flags.note.trim()) body.text = flags.note;

  const result = await api.patch(ctx, `/api/plan/events/${encodeURIComponent(target.id)}`, body);
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  const resolvedSessionId = data.session_id || target.session_id || sessionId;
  const evidenceSuffix = evidence ? ' with evidence' : '';
  console.log(`Updated ${planId}#${milestoneId} to ${status}${resolvedSessionId ? ` (session ${resolvedSessionId})` : ''}${evidenceSuffix}.`);
}

export async function plan(args: string[], flags: any, ctx: any) {
  const sub = args[0];

  if (!sub || sub === 'list') {
    const limit = flags.limit ? Number(flags.limit) : 50;
    const params = new URLSearchParams({ limit: String(limit) });
    if (flagEnabled(flags, 'include-archived', 'includeArchived')) params.set('include_archived', '1');
    const data = await api.get(ctx, `/api/plans?${params.toString()}`);
    const plans: PlanRef[] = data.plans || [];
    if (ctx.json) { console.log(JSON.stringify(plans, null, 2)); return; }
    if (!plans.length) { console.log('No plans yet — emit plan_milestone or plan_test_status events to populate.'); return; }
    console.log(`${plans.length} plan${plans.length === 1 ? '' : 's'}:`);
    for (const p of plans) {
      const ts = p.updated_ts_ms ?? p.last_ts_ms;
      const when = ts ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') : '          ';
      const tag = p.archived ? '  [archived]' : '';
      console.log(`  ${p.plan_id.padEnd(32)}  ${p.session_id.padEnd(36)}  ${String(p.event_count).padStart(4)} events  last ${when}${tag}`);
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
    const params = new URLSearchParams({ plan_id: planId, limit: String(limit), include_archived: '1' });
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

    const archived = Boolean(data.archived ?? isArchivedPlan(events));
    console.log(`Plan ${data.plan_id} (session ${data.session_id})${archived ? ' [archived]' : ''} — ${events.length} events, ${milestoneStatus.size} milestones, ${testStatus.size} tests`);
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

  // v3 legacy archive: only fires when the new v4 lifecycle branch below
  // doesn't recognise the sub — kept here as the LAST fallback for
  // session-scoped event archival in the v3 plan_events store. With the
  // CLI default pointed at v4, the new branch wins; targets that still
  // use v3 (`--server <v3-url>`) can still reach this path via the alias
  // `plan event-archive` (we route the v4 verbs before this block).
  const isLegacyArchive =
    (sub === 'event-archive' || sub === 'event-unarchive');
  if (isLegacyArchive) {
    const planId = args[1];
    if (!planId) {
      console.error(`Usage: ant plan ${sub} <plan_id> [--session <id>]`);
      process.exit(1);
    }
    await setPlanArchived(ctx, flags, planId, sub === 'event-archive');
    return;
  }

  if (sub === 'update') {
    const planId = args[1];
    if (!planId) {
      console.error('Usage: ant plan update <plan_id> --session <id> --milestone <id> --status <status> [--evidence kind:ref:label] [--note text]');
      process.exit(1);
    }
    await updatePlanMilestone(ctx, flags, planId);
    return;
  }

  // plan↔room M:N junction verbs (v4 fresh-ANT). Hit /api/plans/<id>/rooms
  // on the configured server (ctx.serverUrl). Auth: ctx.apiKey bearer
  // matches the requireAdminAuth gate on the POST/DELETE handlers; GET
  // is public-read. Idempotent on both sides.
  //
  // `--server <url>` override lets you point at v4 explicitly while the
  // CLI default still resolves to v3, e.g.:
  //   ant plan attach-room <plan> <room> --server http://localhost:6461
  // Transition-period overrides (until the CLI default migrates to v4):
  //   --server <url>    point at v4 (e.g. http://localhost:6461)
  //   --bearer <token>  use v4's ANT_ADMIN_TOKEN instead of the configured apiKey
  // Once the CLI default is v4 + the v4 admin token is in ~/.ant/config.json,
  // both flags become no-ops.
  let planRoomCtx = ctx;
  if (typeof flags.server === 'string' && flags.server.length > 0) {
    planRoomCtx = { ...planRoomCtx, serverUrl: flags.server };
  }
  if (typeof flags.bearer === 'string' && flags.bearer.length > 0) {
    planRoomCtx = { ...planRoomCtx, apiKey: flags.bearer };
  }
  if (sub === 'rooms') {
    const planId = args[1];
    if (!planId) {
      console.error('Usage: ant plan rooms <plan_id>');
      process.exit(1);
    }
    const data = await api.get(planRoomCtx, `/api/plans/${encodeURIComponent(planId)}/rooms`);
    const rooms: Array<{ roomId: string; name: string; attachedAtMs: number; attachedBy: string | null }> =
      data.rooms || [];
    if (ctx.json) { console.log(JSON.stringify(rooms, null, 2)); return; }
    if (!rooms.length) {
      console.log(`No rooms attached to plan ${planId}.`);
      return;
    }
    console.log(`${rooms.length} room${rooms.length === 1 ? '' : 's'} attached to ${planId}:`);
    for (const r of rooms) {
      const when = new Date(r.attachedAtMs).toISOString().slice(0, 16).replace('T', ' ');
      const by = r.attachedBy ? `  by ${r.attachedBy}` : '';
      console.log(`  ${r.roomId.padEnd(24)}  ${r.name.padEnd(32)}  ${when}${by}`);
    }
    return;
  }

  if (sub === 'attach-room') {
    const planId = args[1];
    const roomId = args[2];
    if (!planId || !roomId) {
      console.error('Usage: ant plan attach-room <plan_id> <room_id> [--by @handle]');
      process.exit(1);
    }
    const attachedBy = typeof flags.by === 'string' ? flags.by : undefined;
    const body: { roomId: string; attachedBy?: string } = { roomId };
    if (attachedBy) body.attachedBy = attachedBy;
    const result = await api.post(planRoomCtx, `/api/plans/${encodeURIComponent(planId)}/rooms`, body);
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    if (result.alreadyAttached) {
      console.log(`Plan ${planId} is already attached to room ${roomId}.`);
    } else {
      console.log(`Attached plan ${planId} to room ${roomId}${attachedBy ? ` (by ${attachedBy})` : ''}.`);
    }
    return;
  }

  if (sub === 'detach-room') {
    const planId = args[1];
    const roomId = args[2];
    if (!planId || !roomId) {
      console.error('Usage: ant plan detach-room <plan_id> <room_id>');
      process.exit(1);
    }
    const path = `/api/plans/${encodeURIComponent(planId)}/rooms/${encodeURIComponent(roomId)}`;
    const result = await api.del(planRoomCtx, path);
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    if (result?.removed) {
      console.log(`Detached plan ${planId} from room ${roomId}.`);
    } else {
      console.log(`Plan ${planId} was not attached to room ${roomId}.`);
    }
    return;
  }

  // === v4 plan lifecycle verbs (planStore). All admin-bearer. Same
  // --server / --bearer transition overrides as the room-junction verbs.
  // Idempotent: archive of already-archived is a no-op, restore of
  // already-active is a no-op, etc.

  if (sub === 'create') {
    const planId = args[1];
    const title = typeof flags.title === 'string' ? flags.title : undefined;
    const description = typeof flags.description === 'string' ? flags.description : undefined;
    const createdBy = typeof flags.by === 'string' ? flags.by : undefined;
    if (!planId) {
      console.error('Usage: ant plan create <plan_id> [--title T] [--description D] [--by @handle]');
      process.exit(1);
    }
    const body: Record<string, string> = { id: planId };
    if (title) body.title = title;
    if (description) body.description = description;
    if (createdBy) body.createdBy = createdBy;
    const result = await api.post(planRoomCtx, `/api/plans`, body);
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    const p = result.plan;
    console.log(`Created plan ${p.id}${p.title ? ` — "${p.title}"` : ''}.`);
    return;
  }

  if (sub === 'archive' || sub === 'unarchive' || sub === 'delete' || sub === 'restore-delete') {
    const planId = args[1];
    if (!planId) {
      console.error(`Usage: ant plan ${sub} <plan_id>`);
      process.exit(1);
    }
    const action =
      sub === 'archive' ? 'archive'
      : sub === 'unarchive' ? 'unarchive'
      : sub === 'delete' ? 'delete'
      : 'restore';
    const result = await api.patch(planRoomCtx, `/api/plans/${encodeURIComponent(planId)}`, { action });
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    const p = result.plan;
    const verbDone =
      action === 'archive' ? 'Archived'
      : action === 'unarchive' ? 'Restored to active'
      : action === 'delete' ? 'Soft-deleted'
      : 'Recovered from soft-delete';
    console.log(`${verbDone} plan ${p.id}${p.title ? ` — "${p.title}"` : ''}.`);
    return;
  }

  if (sub === 'trigger') {
    // `ant plan trigger <sub>` — ANTSCRIPT v1 lifecycle hooks for v4.
    // Operates against /api/plan-triggers on the configured server.
    const tsub = args[1];
    if (tsub === 'add') {
      // ant plan trigger add <event> <action> [--plan <id>] [--message <tpl>] [--by @h]
      //                                       [--url <u>]    (webhook.post)
      //                                       [--body-template <tpl>] (webhook.post)
      //                                       [--subject <s>] [--target-plan same|<id>]
      //                                       [--priority N] [--agent @h] [--description D]
      //                                                       (task.create)
      const event = args[2];
      const action = args[3];
      if (!event || !action) {
        console.error('Usage: ant plan trigger add <event> <action> [--plan <id>] [--by @handle]');
        console.error('  events:  plan.{completed,archived,deleted,restored} | task.{created,completed,blocked,assigned}');
        console.error('  actions: room.message | console.log | webhook.post | task.create');
        console.error('  per-action flags:');
        console.error('    room.message / console.log   — [--message "<template>"]');
        console.error('    webhook.post                 — --url <url> [--body-template "<tpl>"] [--header KEY=VAL ...]');
        console.error('    task.create                  — --subject "<s>" [--target-plan same|<id>] [--priority N] [--agent @h] [--description D]');
        process.exit(1);
      }
      const planId = typeof flags.plan === 'string' ? flags.plan : null;
      const message = typeof flags.message === 'string' ? flags.message : null;
      const createdBy = typeof flags.by === 'string' ? flags.by : null;
      const actionConfig: Record<string, unknown> = {};

      switch (action) {
        case 'room.message':
          if (message !== null) actionConfig.messageTemplate = message;
          break;
        case 'console.log':
          if (message !== null) actionConfig.message = message;
          break;
        case 'webhook.post':
          if (typeof flags.url === 'string') actionConfig.url = flags.url;
          if (typeof flags['body-template'] === 'string') {
            actionConfig.bodyTemplate = flags['body-template'];
          }
          // Repeatable --header KEY=VAL — re-scanned from argv because the
          // shared parseArgs() is last-wins on duplicate keys.
          {
            const hdrs: Record<string, string> = {};
            const argv = process.argv;
            for (let i = 0; i < argv.length - 1; i++) {
              if (argv[i] === '--header' || argv[i] === '-H') {
                const kv = argv[i + 1] ?? '';
                const eq = kv.indexOf('=');
                if (eq > 0) hdrs[kv.slice(0, eq).trim().toLowerCase()] = kv.slice(eq + 1);
              }
            }
            if (Object.keys(hdrs).length > 0) actionConfig.headers = hdrs;
          }
          if (!actionConfig.url) {
            console.error('webhook.post requires --url <url>');
            process.exit(1);
          }
          break;
        case 'task.create':
          if (typeof flags.subject === 'string') actionConfig.subject = flags.subject;
          if (typeof flags['target-plan'] === 'string') actionConfig.planId = flags['target-plan'];
          if (typeof flags.priority === 'string' && /^-?\d+$/.test(flags.priority)) {
            actionConfig.priority = Number(flags.priority);
          } else if (typeof flags.priority === 'number') {
            actionConfig.priority = flags.priority;
          }
          if (typeof flags.agent === 'string') actionConfig.assignedAgent = flags.agent;
          if (typeof flags.description === 'string') actionConfig.description = flags.description;
          if (!actionConfig.subject) {
            console.error('task.create requires --subject "<subject>"');
            process.exit(1);
          }
          break;
        default:
          // Unknown action — let the server return the 400, don't pre-validate.
          // Forward any --message as a best-effort fallback.
          if (message !== null) actionConfig.message = message;
      }

      const body: Record<string, unknown> = { event, action, actionConfig };
      if (planId !== null) body.planId = planId;
      if (createdBy !== null) body.createdBy = createdBy;
      const result = await api.post(planRoomCtx, `/api/plan-triggers`, body);
      if (ctx.json) { console.log(JSON.stringify(result)); return; }
      const t = result.trigger;
      console.log(`Added trigger ${t.id} — ${t.event} → ${t.action}${t.planId ? ` (plan: ${t.planId})` : ' (wildcard)'}.`);
      return;
    }
    if (tsub === 'list' || tsub === undefined) {
      const planId = typeof flags.plan === 'string' ? flags.plan : undefined;
      const qs = planId ? `?planId=${encodeURIComponent(planId)}` : '';
      const result = await api.get(planRoomCtx, `/api/plan-triggers${qs}`);
      if (ctx.json) { console.log(JSON.stringify(result.triggers, null, 2)); return; }
      const triggers: Array<Record<string, unknown>> = result.triggers || [];
      if (!triggers.length) { console.log('No triggers.'); return; }
      console.log(`${triggers.length} trigger${triggers.length === 1 ? '' : 's'}:`);
      for (const t of triggers) {
        const fired = t.fireCount ? `  fired ${t.fireCount}×` : '  (never fired)';
        const scope = t.planId ? `plan=${t.planId}` : 'wildcard';
        console.log(`  ${String(t.id).padEnd(20)}  ${String(t.event).padEnd(16)}  ${String(t.action).padEnd(14)}  ${scope}${fired}`);
      }
      return;
    }
    if (tsub === 'remove') {
      const triggerId = args[2];
      if (!triggerId) {
        console.error('Usage: ant plan trigger remove <trigger_id>');
        process.exit(1);
      }
      await api.del(planRoomCtx, `/api/plan-triggers/${encodeURIComponent(triggerId)}`);
      if (ctx.json) { console.log(JSON.stringify({ removed: true })); return; }
      console.log(`Removed trigger ${triggerId}.`);
      return;
    }
    if (tsub === 'fire') {
      const triggerId = args[2];
      if (!triggerId) {
        console.error('Usage: ant plan trigger fire <trigger_id> [--plan <id>]');
        process.exit(1);
      }
      const planId = typeof flags.plan === 'string' ? flags.plan : undefined;
      const body: Record<string, string> = {};
      if (planId) body.planId = planId;
      const result = await api.post(planRoomCtx, `/api/plan-triggers/${encodeURIComponent(triggerId)}/fire`, body);
      if (ctx.json) { console.log(JSON.stringify(result)); return; }
      console.log(`Fired trigger ${triggerId} — ${result.event} on ${result.planId}.`);
      return;
    }
    console.error('Usage: ant plan trigger <add|list|remove|fire>');
    console.error('  ant plan trigger add <event> <action> [--plan <id>] [--message <tpl>] [--by @h]');
    console.error('  ant plan trigger list [--plan <id>]');
    console.error('  ant plan trigger remove <trigger_id>');
    console.error('  ant plan trigger fire <trigger_id> [--plan <id>]');
    process.exit(1);
  }

  if (sub === 'meta') {
    const planId = args[1];
    if (!planId) {
      console.error('Usage: ant plan meta <plan_id> [--title T] [--description D]');
      process.exit(1);
    }
    const patch: Record<string, string | null> = {};
    if (typeof flags.title === 'string') patch.title = flags.title;
    if (typeof flags.description === 'string') patch.description = flags.description;
    if (Object.keys(patch).length === 0) {
      console.error('No fields to update. Pass --title and/or --description.');
      process.exit(1);
    }
    const result = await api.patch(planRoomCtx, `/api/plans/${encodeURIComponent(planId)}`, patch);
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    const p = result.plan;
    console.log(`Updated plan ${p.id} metadata${p.title ? ` — "${p.title}"` : ''}.`);
    return;
  }

  console.error('Usage: ant plan <list|show|update|archive|unarchive|rooms|attach-room|detach-room|create|delete|restore-delete|meta>');
  console.error('  ant plan list [--limit N] [--include-archived]');
  console.error('  ant plan show <plan_id> [--session <id>] [--limit N]');
  console.error('  ant plan update <plan_id> --session <id> --milestone <id> --status <status> [--evidence kind:ref:label] [--note text]');
  console.error('  ant plan rooms <plan_id> [--server <url>]                                   — list rooms attached to a plan');
  console.error('  ant plan attach-room <plan_id> <room_id> [--by @handle] [--server <url>] [--bearer <token>]');
  console.error('  ant plan detach-room <plan_id> <room_id> [--server <url>] [--bearer <token>]');
  console.error('  --- v4 lifecycle (planStore) ---');
  console.error('  ant plan create <plan_id> [--title T] [--description D] [--by @handle]');
  console.error('  ant plan archive <plan_id>           — soft-archive (idempotent)');
  console.error('  ant plan unarchive <plan_id>         — restore from archived');
  console.error('  ant plan delete <plan_id>            — soft-delete (idempotent)');
  console.error('  ant plan restore-delete <plan_id>    — recover from soft-delete');
  console.error('  ant plan meta <plan_id> [--title T] [--description D]');
  console.error('  --- ANTSCRIPT triggers ---');
  console.error('  ant plan trigger add <event> <action> [--plan <id>] [--message <tpl>] [--by @h]');
  console.error('  ant plan trigger list [--plan <id>]');
  console.error('  ant plan trigger remove <trigger_id>');
  console.error('  ant plan trigger fire <trigger_id> [--plan <id>]');
  process.exit(1);
}
