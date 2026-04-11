// ANT v3 CLI — mempalace access
//
//   ant memory get <key>                Read one row by key
//   ant memory put <key> <value>        Upsert one row (value as JSON or string)
//   ant memory list <prefix>            List all rows under a key prefix
//   ant memory search <query>           FTS5 search across all memory
//   ant memory delete <key>             Delete one row by key
//
// See docs/mempalace-schema.md for the key conventions agents should
// follow (goals/, tasks/, agents/, done/, heartbeat/, digest/).

import { api } from '../lib/api.js';

export async function memory(args: string[], flags: any, ctx: any) {
  const sub = args[0];

  if (!sub) {
    console.error('Usage: ant memory <get|put|list|search|delete> [args]');
    console.error('See docs/mempalace-schema.md for key conventions.');
    return;
  }

  if (sub === 'get') {
    const key = args[1];
    if (!key) { console.error('Usage: ant memory get <key>'); return; }
    const result = await api.get(ctx, `/api/memories/key/${encodeURIComponent(key)}`);
    if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
    const mem = result.memory;
    if (!mem) { console.log(`(no memory at ${key})`); return; }
    printMemoryRow(mem);
    return;
  }

  if (sub === 'put') {
    const key = args[1];
    const value = flags.value ?? args.slice(2).join(' ');
    if (!key || !value) {
      console.error('Usage: ant memory put <key> <value>');
      console.error('  value may be JSON or a plain string; JSON is stored verbatim');
      return;
    }
    const tags = Array.isArray(flags.tags) ? flags.tags
               : typeof flags.tags === 'string' ? flags.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
               : [];
    const body: any = { value, tags };
    if (flags.session)    body.session_id = flags.session;
    if (flags.created_by) body.created_by = flags.created_by;

    const result = await putJson(ctx, `/api/memories/key/${encodeURIComponent(key)}`, body);

    if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
    console.log(`✓ ${key}`);
    return;
  }

  if (sub === 'list') {
    const prefix = args[1];
    if (!prefix) { console.error('Usage: ant memory list <prefix>  (e.g. tasks/ or agents/)'); return; }
    const limit = flags.limit ? `&limit=${flags.limit}` : '';
    const result = await api.get(ctx, `/api/memories/prefix?prefix=${encodeURIComponent(prefix)}${limit}`);
    if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
    if (!result.rows?.length) { console.log(`(no rows under ${prefix})`); return; }
    console.log(`${result.count} rows under ${prefix}:\n`);
    for (const r of result.rows) printMemoryRowSummary(r);
    return;
  }

  if (sub === 'search') {
    const q = args.slice(1).join(' ');
    if (!q) { console.error('Usage: ant memory search <query>'); return; }
    const limit = flags.limit ? `&limit=${flags.limit}` : '';
    const result = await api.get(ctx, `/api/memories?q=${encodeURIComponent(q)}${limit}`);
    if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
    if (!result.memories?.length) { console.log(`(no matches for "${q}")`); return; }
    for (const m of result.memories) {
      console.log(`\x1b[1m${m.key}\x1b[0m`);
      if (m.snippet) console.log(`  ${m.snippet}`);
    }
    return;
  }

  if (sub === 'delete') {
    const key = args[1];
    if (!key) { console.error('Usage: ant memory delete <key>'); return; }
    await api.del(ctx, `/api/memories/key/${encodeURIComponent(key)}`);
    if (ctx.json) { console.log(JSON.stringify({ ok: true })); return; }
    console.log(`✓ deleted ${key}`);
    return;
  }

  console.error(`Unknown memory subcommand: ${sub}`);
}

// Minimal PUT helper because api.ts doesn't export `put` today.
async function putJson(ctx: any, path: string, body: any): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ctx.apiKey) headers['Authorization'] = `Bearer ${ctx.apiKey}`;
  const res = await fetch(`${ctx.serverUrl}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
    // @ts-ignore self-signed cert
    tls: { rejectUnauthorized: false },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function printMemoryRow(mem: any) {
  console.log(`\x1b[1m${mem.key}\x1b[0m  \x1b[90m${mem.updated_at}\x1b[0m`);
  try {
    const parsed = JSON.parse(mem.value);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(mem.value);
  }
}

function printMemoryRowSummary(mem: any) {
  let preview = mem.value ?? '';
  try {
    const parsed = JSON.parse(mem.value);
    preview = parsed.title ?? parsed.summary ?? JSON.stringify(parsed).slice(0, 80);
  } catch {
    preview = String(preview).slice(0, 80);
  }
  console.log(`  \x1b[1m${mem.key}\x1b[0m  \x1b[90m${mem.updated_at}\x1b[0m`);
  console.log(`    ${preview}`);
}
