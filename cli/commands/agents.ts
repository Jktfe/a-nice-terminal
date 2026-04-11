// ANT v3 CLI — agent registry access
//
//   ant agents list             Pretty-print all rows under agents/
//   ant agents show <id>        Full row for one agent
//
// Both commands are thin wrappers over the mempalace key conventions in
// docs/mempalace-schema.md — agents live at `agents/<id>` with a well-known
// value shape (strengths, avoid, cost, reliability, last_seen, …).

import { api } from '../lib/api.js';

export async function agents(args: string[], flags: any, ctx: any) {
  const sub = args[0] || 'list';

  if (sub === 'list') {
    const result = await api.get(ctx, `/api/memories/prefix?prefix=${encodeURIComponent('agents/')}`);
    const rows = (result.rows || []) as any[];

    if (ctx.json) {
      const parsed = rows.map(r => ({ key: r.key, ...safeParse(r.value), updated_at: r.updated_at }));
      console.log(JSON.stringify(parsed, null, 2));
      return;
    }

    if (!rows.length) {
      console.log('(no agents registered — write agents/<id> memories to populate)');
      console.log('See docs/mempalace-schema.md for the expected shape.');
      return;
    }

    console.log(`${rows.length} agents:\n`);
    console.log(pad('ID', 18) + pad('COST', 10) + pad('RELIAB', 8) + pad('SEEN', 22) + 'STRENGTHS');
    console.log('─'.repeat(80));
    for (const row of rows) {
      const v = safeParse(row.value);
      const id = v.id ?? row.key.replace(/^agents\//, '');
      const cost = v.cost ?? '?';
      const reliability = v.reliability != null ? v.reliability.toFixed(2) : '?';
      const lastSeen = v.last_seen ? short(v.last_seen) : '(never)';
      const strengths = (v.strengths ?? []).join(', ').slice(0, 40);
      console.log(pad(id, 18) + pad(cost, 10) + pad(reliability, 8) + pad(lastSeen, 22) + strengths);
    }
    console.log('\nFor one agent\'s full row:  ant agents show <id>');
    return;
  }

  if (sub === 'show') {
    const id = args[1];
    if (!id) { console.error('Usage: ant agents show <id>'); return; }
    const key = `agents/${id}`;
    const result = await api.get(ctx, `/api/memories/key/${encodeURIComponent(key)}`).catch(() => null);
    if (!result?.memory) {
      console.error(`No agent at ${key}`);
      return;
    }
    if (ctx.json) { console.log(JSON.stringify(result.memory, null, 2)); return; }
    console.log(`\x1b[1m${result.memory.key}\x1b[0m  \x1b[90m${result.memory.updated_at}\x1b[0m`);
    const v = safeParse(result.memory.value);
    console.log(JSON.stringify(v, null, 2));
    return;
  }

  console.error(`Unknown agents subcommand: ${sub}`);
}

function safeParse(value: string): any {
  try { return JSON.parse(value); } catch { return { _raw: value }; }
}

function pad(s: string, n: number): string {
  s = String(s ?? '');
  return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length);
}

function short(iso: string): string {
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return iso.slice(0, 21);
  }
}
