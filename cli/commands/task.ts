// ant task <session-id> create "title" [--desc "..."]
// ant task <session-id> list
// ant task <session-id> accept <task-id>
// ant task <session-id> assign <task-id> @handle
// ant task <session-id> review <task-id>
// ant task <session-id> done <task-id>
// ant task <session-id> delete <task-id>

import { api } from '../lib/api.js';
import { identitySourceLabel, resolveIdentityDetailsAsync } from '../lib/identity.js';

const STATUSES: Record<string, string> = {
  accept: 'accepted',
  assign: 'assigned',
  review: 'review',
  done: 'complete',
  delete: 'deleted',
};

const STATUS_COLOURS: Record<string, string> = {
  proposed:        '\x1b[33m',  // yellow
  accepted:        '\x1b[36m',  // cyan
  'to-be-assigned':'\x1b[35m',  // magenta
  assigned:        '\x1b[34m',  // blue
  review:          '\x1b[33m',  // yellow
  complete:        '\x1b[32m',  // green
  deleted:         '\x1b[31m',  // red
};

function colourStatus(s: string) {
  return `${STATUS_COLOURS[s] || ''}${s}\x1b[0m`;
}

export async function task(args: string[], flags: any, ctx: any) {
  const sessionId = args[0];
  const sub = args[1];

  if (!sessionId || !sub) {
    console.error('Usage: ant task <session-id> <create|list|accept|assign|review|done|delete> [...]');
    return;
  }

  if (sub === 'list') {
    const data = await api.get(ctx, `/api/sessions/${sessionId}/tasks`);
    const tasks = data.tasks || [];
    if (ctx.json) { console.log(JSON.stringify(tasks)); return; }
    if (!tasks.length) { console.log('No tasks'); return; }
    for (const t of tasks) {
      const assignee = t.assigned_to ? ` → ${t.assigned_to}` : '';
      console.log(`  [${t.id.slice(0, 8)}] ${colourStatus(t.status)}${assignee}  ${t.title}`);
      const meta = [
        t.created_by ? `by ${t.created_by}` : null,
        t.created_source ? `via ${t.created_source}` : null,
        t.plan_id ? `plan ${t.plan_id}${t.milestone_id ? `#${t.milestone_id}` : ''}` : null,
      ].filter(Boolean);
      if (meta.length) console.log(`           ${meta.join(' · ')}`);
      if (t.description) console.log(`           ${t.description}`);
    }
    return;
  }

  if (sub === 'create') {
    const title = flags.title || args[2];
    if (!title) { console.error('Usage: ant task <session-id> create "title" [--desc "..."]'); return; }
    const identity = await resolveIdentityDetailsAsync(ctx, !!flags.external, {
      from: typeof flags.from === 'string' ? flags.from : undefined,
      sessionId: typeof flags.session === 'string' ? flags.session : undefined,
      handle: typeof flags.handle === 'string' ? flags.handle : undefined,
    });
    const me = identity.handle || identity.senderId;
    const result = await api.post(ctx, `/api/sessions/${sessionId}/tasks`, {
      title,
      description: flags.desc || null,
      created_by: me,
      created_source: 'cli',
      creator_identity_source: identity.source,
      plan_id: flags.plan || null,
      milestone_id: flags.milestone || null,
      acceptance_id: flags.acceptance || null,
    });
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    const planSuffix = result.task?.plan_id
      ? ` (${result.task.plan_id}${result.task.milestone_id ? `#${result.task.milestone_id}` : ''})`
      : '';
    console.log(`Task created: [${result.task?.id?.slice(0, 8)}] ${title}${planSuffix}`);
    console.log(`Created by: ${me} via CLI (${identitySourceLabel(identity.source)})`);
    return;
  }

  // Status transitions: accept / review / done / delete
  if (STATUSES[sub]) {
    const taskId = args[2];
    if (!taskId) { console.error(`Usage: ant task <session-id> ${sub} <task-id>`); return; }

    const body: Record<string, any> = { status: STATUSES[sub] };
    if (sub === 'assign') {
      const handle = args[3];
      if (!handle) { console.error('Usage: ant task <session-id> assign <task-id> @handle'); return; }
      body.status = 'assigned';
      body.assigned_to = handle;
    }

    const result = await api.patch(ctx, `/api/sessions/${sessionId}/tasks/${taskId}`, body);
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    const t = result.task;
    const assignee = t?.assigned_to ? ` → ${t.assigned_to}` : '';
    console.log(`Task [${taskId.slice(0, 8)}] → ${colourStatus(t?.status || STATUSES[sub])}${assignee}`);
    return;
  }

  console.error(`Unknown sub-command: ${sub}`);
}
