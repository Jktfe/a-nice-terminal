// antchat tasks — list / create / transition tasks scoped to a room.
//
// Mirrors `ant task` but with antchat's tighter help surface and
// per-room-token authentication so a colleague's machine doesn't need the
// master apiKey.

import { api } from '../../cli/lib/api.js';
import { config } from '../../cli/lib/config.js';

const STATUS_TRANSITIONS: Record<string, string> = {
  accept: 'accepted',
  assign: 'assigned',
  review: 'review',
  done: 'complete',
  delete: 'deleted',
};

const STATUS_COLOURS: Record<string, string> = {
  proposed:        '\x1b[33m',
  accepted:        '\x1b[36m',
  'to-be-assigned':'\x1b[35m',
  assigned:        '\x1b[34m',
  review:          '\x1b[33m',
  complete:        '\x1b[32m',
  deleted:         '\x1b[31m',
};

function colourStatus(status: string): string {
  return `${STATUS_COLOURS[status] ?? ''}${status}\x1b[0m`;
}

function help(): never {
  console.error([
    'Usage:',
    '  antchat tasks <room-id> list',
    '  antchat tasks <room-id> create "title" [--desc "..."]',
    '  antchat tasks <room-id> accept|review|done|delete <task-id>',
    '  antchat tasks <room-id> assign <task-id> @handle',
  ].join('\n'));
  process.exit(1);
}

export async function tasks(args: string[], flags: any, ctx: any) {
  const roomId = args[0];
  const sub = args[1];
  if (!roomId || !sub) help();

  const handleFlag = typeof flags.handle === 'string' ? flags.handle : undefined;
  const tok = config.getRoomToken(roomId, handleFlag);
  if (!tok) {
    console.error(`antchat tasks: no token for room ${roomId}. Run: antchat join ...`);
    process.exit(1);
  }

  const serverUrl = (ctx.serverUrl || tok.server_url || config.get('serverUrl') || '').trim();
  if (!serverUrl) {
    console.error('antchat tasks: no server URL - pass --server or rejoin to capture server_url in the token.');
    process.exit(1);
  }

  const callCtx = { ...ctx, serverUrl };
  const room = { roomToken: tok.token };
  const me = tok.handle || (typeof flags.from === 'string' ? flags.from : 'antchat');

  if (sub === 'list') {
    const data = await api.get(callCtx, `/api/sessions/${roomId}/tasks`, room);
    const list = (data.tasks || []) as Array<Record<string, any>>;
    if (ctx.json) { console.log(JSON.stringify(list)); return; }
    if (!list.length) { console.log('No tasks'); return; }
    for (const t of list) {
      const idShort = String(t.id ?? '').slice(0, 8);
      const status = colourStatus(String(t.status ?? 'proposed'));
      const assignee = t.assigned_to ? ` -> ${t.assigned_to}` : '';
      console.log(`  [${idShort}] ${status}${assignee}  ${t.title ?? ''}`);
      if (t.description) console.log(`           ${t.description}`);
    }
    return;
  }

  if (sub === 'create') {
    const title = (typeof flags.title === 'string' ? flags.title : '') || args[2];
    if (!title) help();
    const result = await api.post(callCtx, `/api/sessions/${roomId}/tasks`, {
      title,
      description: typeof flags.desc === 'string' ? flags.desc : null,
      created_by: me,
    }, room);
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    const id = String(result.task?.id ?? '').slice(0, 8);
    console.log(`Task created: [${id}] ${title}`);
    return;
  }

  if (STATUS_TRANSITIONS[sub]) {
    const taskId = args[2];
    if (!taskId) help();
    const body: Record<string, any> = { status: STATUS_TRANSITIONS[sub] };
    if (sub === 'assign') {
      const handle = args[3];
      if (!handle) help();
      body.status = 'assigned';
      body.assigned_to = handle.startsWith('@') ? handle : `@${handle}`;
    }
    const result = await api.patch(callCtx, `/api/sessions/${roomId}/tasks/${taskId}`, body, room);
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    const t = result.task || {};
    const status = colourStatus(String(t.status ?? STATUS_TRANSITIONS[sub]));
    const assignee = t.assigned_to ? ` -> ${t.assigned_to}` : '';
    console.log(`Task [${taskId.slice(0, 8)}] -> ${status}${assignee}`);
    return;
  }

  console.error(`antchat tasks: unknown sub-command '${sub}'.`);
  help();
}
