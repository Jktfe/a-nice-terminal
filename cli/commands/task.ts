// ant task <session-id> create "title" [--desc "..."]
// ant task <session-id> list
// ant task <session-id> accept <task-id>
// ant task <session-id> assign <task-id> @handle
// ant task <session-id> review <task-id>
// ant task <session-id> done <task-id>
// ant task <session-id> delete <task-id>

import { api } from '../lib/api.js';
import { config } from '../lib/config.js';

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

  const me = flags.from || config.get('sessionId') || config.get('handle') || 'cli';

  if (sub === 'list') {
    const data = await api.get(ctx, `/api/sessions/${sessionId}/tasks`);
    const tasks = data.tasks || [];
    if (ctx.json) { console.log(JSON.stringify(tasks)); return; }
    if (!tasks.length) { console.log('No tasks'); return; }
    for (const t of tasks) {
      const assignee = t.assigned_to ? ` → ${t.assigned_to}` : '';
      console.log(`  [${t.id.slice(0, 8)}] ${colourStatus(t.status)}${assignee}  ${t.title}`);
      if (t.description) console.log(`           ${t.description}`);
    }
    return;
  }

  if (sub === 'create') {
    const title = flags.title || args[2];
    if (!title) { console.error('Usage: ant task <session-id> create "title" [--desc "..."]'); return; }
    const result = await api.post(ctx, `/api/sessions/${sessionId}/tasks`, {
      title,
      description: flags.desc || null,
      created_by: me,
    });
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    console.log(`Task created: [${result.task?.id?.slice(0, 8)}] ${title}`);
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
