// ant fingerprint — M3.2a CLI per design contract Q7.
// Verbs: detect <terminal-id> [--json] [--write-back]
const BOOL = new Set(['json', 'write-back']);

function parseFlags(args, E) {
  const flags = {}, pos = []; let i = 0;
  while (i < args.length) {
    const t = args[i];
    if (!t.startsWith('--')) { pos.push(t); i += 1; continue; }
    const n = t.slice(2);
    if (BOOL.has(n)) { flags[n] = 'true'; i += 1; continue; }
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) throw new E(`flag --${n} needs a value`);
    flags[n] = v; i += 2;
  }
  return { flags, pos };
}

function adminToken(flags, E) {
  const f = flags['admin-token'];
  if (typeof f === 'string' && f.length > 0) return f;
  const e = process.env.ANT_ADMIN_TOKEN;
  if (typeof e === 'string' && e.length > 0) return e;
  throw new E('--write-back requires admin token: pass --admin-token or set ANT_ADMIN_TOKEN');
}

function emit(rt, payload, json) {
  if (json) { rt.writeOut(JSON.stringify(payload)); return; }
  const driver = payload.driver
    ? `${payload.driver.binary}@${payload.driver.version}` : 'none';
  rt.writeOut(
    `${payload.terminal_id}\tkind=${payload.kind}\tdriver=${driver}` +
    `\tconfidence=${payload.confidence}\tfallback=${payload.fallback || '-'}` +
    `\tevidence=${payload.evidence.source}:${payload.evidence.detail}`);
}

function writeUsage(r) {
  r.writeOut('ant fingerprint detect <terminal-id> [--json] [--write-back] [--admin-token T]');
  r.writeOut('  detect          Run 5-source cascade; returns kind/driver/confidence/fallback');
  r.writeOut('  --write-back    HIGH-confidence updates terminals.agent_kind+meta (admin-bearer)');
}

async function runDetect(pos, flags, rt, E) {
  const id = pos[0];
  if (!id) throw new E('fingerprint detect needs a TERMINAL_ID');
  const writeBack = flags['write-back'] !== undefined;
  const headers = {};
  let secrets = [];
  if (writeBack) {
    const tok = adminToken(flags, E);
    headers.authorization = `Bearer ${tok}`;
    secrets = [tok];
  }
  const path = `/api/terminals/${encodeURIComponent(id)}/fingerprint${writeBack ? '?writeBack=1' : ''}`;
  const res = await rt.fetchImpl(`${rt.serverUrl}${path}`, { headers });
  if (!res.ok) {
    let body = '';
    try { body = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    for (const s of secrets) if (typeof s === 'string' && s.length > 0) body = body.split(s).join('***');
    rt.writeErr(`Request failed (${res.status}): ${body}`);
    return 1;
  }
  emit(rt, await res.json(), flags.json !== undefined);
  return 0;
}

export async function handleFingerprintVerb(action, args, rt, ctx) {
  const { CliInputError: E } = ctx;
  const { flags, pos } = parseFlags(args, E);
  switch (action) {
    case 'detect': return runDetect(pos, flags, rt, E);
    case undefined: case 'help': case '--help':
      writeUsage(rt); return action === undefined ? 1 : 0;
    default: writeUsage(rt); throw new E(`unknown fingerprint verb: ${action}`);
  }
}
