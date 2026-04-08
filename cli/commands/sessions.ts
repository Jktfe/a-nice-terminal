import { api } from '../lib/api.js';

export async function sessions(args: string[], flags: any, ctx: any) {
  const sub = args[0];

  if (sub === 'create') {
    const name = flags.name || 'New Session';
    const type = flags.type || 'terminal';
    const session = await api.post(ctx, '/api/sessions', { name, type });
    if (ctx.json) { console.log(JSON.stringify(session)); return; }
    console.log(`Created ${session.type} session: ${session.name} (${session.id})`);
    return;
  }

  if (sub === 'archive') {
    const id = args[1];
    if (!id) { console.error('Usage: ant sessions archive <id>'); return; }
    await api.patch(ctx, `/api/sessions/${id}`, { archived: true });
    console.log(`Archived session ${id}`);
    return;
  }

  if (sub === 'delete') {
    const id = args[1];
    if (!id) { console.error('Usage: ant sessions delete <id>'); return; }
    await api.del(ctx, `/api/sessions/${id}`);
    console.log(`Deleted session ${id}`);
    return;
  }

  if (sub === 'export') {
    const id = args[1];
    if (!id) { console.error('Usage: ant sessions export <id>'); return; }
    await api.post(ctx, `/api/sessions/${id}/export`, {});
    console.log(`Exported session ${id} to Obsidian`);
    return;
  }

  // Default: list sessions
  const list = await api.get(ctx, '/api/sessions');
  if (ctx.json) { console.log(JSON.stringify(list)); return; }

  if (list.length === 0) { console.log('No sessions'); return; }
  console.log(`${'ID'.padEnd(22)} ${'Name'.padEnd(25)} ${'Type'.padEnd(12)} Status`);
  console.log('-'.repeat(70));
  for (const s of list) {
    console.log(`${s.id.padEnd(22)} ${s.name.padEnd(25)} ${s.type.padEnd(12)} ${s.status}`);
  }
}
