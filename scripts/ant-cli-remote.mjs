// ant remote / ant remote-room — M4 CLI per docs/m4-t3-gate-bars-2026-05-14.md.
// PATH A v1: remote-room status wraps GET /mappings/:id; counts → v2.
const BOOL = new Set(['json']);
const LIFETIMES = new Set(['today', '48h', '7d', 'indefinite']);
const DIRECTIONS = new Set(['in', 'out', 'both']);
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
function need(flags, name, E) {
  const v = flags[name];
  if (v === undefined || v.length === 0) throw new E(`missing required flag --${name}`);
  return v;
}
function adminToken(flags, E) {
  const f = flags['admin-token'];
  if (typeof f === 'string' && f.length > 0) return f;
  const e = process.env.ANT_ADMIN_TOKEN;
  if (typeof e === 'string' && e.length > 0) return e;
  throw new E('admin token required: pass --admin-token or set ANT_ADMIN_TOKEN');
}
async function call(rt, path, init, secrets = []) {
  const res = await rt.fetchImpl(`${rt.serverUrl}${path}`, init);
  if (!res.ok) {
    let body = '';
    try { body = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    for (const s of secrets) if (typeof s === 'string' && s.length > 0) body = body.split(s).join('***');
    rt.writeErr(`Request failed (${res.status}): ${body}`); return null;
  }
  return res.json();
}
function emit(rt, payload, json, textFn) {
  rt.writeOut(json ? JSON.stringify(payload) : textFn(payload));
}
const adminH = (t) => ({ 'content-type': 'application/json', authorization: `Bearer ${t}` });
export async function handleRemoteVerb(action, args, rt, ctx) {
  const { CliInputError: E } = ctx;
  const { flags, pos } = parseFlags(args, E);
  switch (action) {
    case 'admit': return runAdmit(flags, rt, E);
    case 'redeem': return runRedeem(flags, rt, E);
    case 'mapping': return runMapping(pos, flags, rt, E);
    case undefined: case 'help': case '--help':
      writeRemoteUsage(rt); return action === undefined ? 1 : 0;
    default: writeRemoteUsage(rt); throw new E(`unknown remote verb: ${action}`);
  }
}
export async function handleRemoteRoomVerb(action, args, rt, ctx) {
  const { CliInputError: E } = ctx;
  const { flags, pos } = parseFlags(args, E);
  switch (action) {
    case 'send': return runRoomSend(pos, flags, rt, E);
    case 'status': return runRoomStatus(pos, flags, rt, E);
    case 'ack': return runRoomAck(pos, flags, rt, E);
    case 'quarantine': return runRoomQuarantine(pos, flags, rt, E);
    case undefined: case 'help': case '--help':
      writeRoomUsage(rt); return action === undefined ? 1 : 0;
    default: writeRoomUsage(rt); throw new E(`unknown remote-room verb: ${action}`);
  }
}
function writeRemoteUsage(r) {
  r.writeOut('ant remote <admit|redeem|mapping> [flags]');
  r.writeOut('  admit --room R --lifetime today|48h|7d|indefinite [--admin-token T] [--json]');
  r.writeOut('  redeem --code CODE --admission-id ID --remote-url URL --label LABEL [--direction in|out|both] [--json]');
  r.writeOut('  mapping list --room R | mapping show ID | mapping revoke ID  [--admin-token T] [--json]');
}
function writeRoomUsage(r) {
  r.writeOut('ant remote-room <send|status|ack|quarantine list> [flags]');
  r.writeOut('  send MAPPING_ID --msg TEXT [--admin-token T] [--json]');
  r.writeOut('  status MAPPING_ID [--admin-token T] [--json]   # v1 narrow: mapping detail');
  r.writeOut('  ack EVENT_ID [--admin-token T] [--json]');
  r.writeOut('  quarantine list [--mapping-id M] [--admin-token T] [--json]');
}
async function runAdmit(flags, rt, E) {
  const room = need(flags, 'room', E), lifetime = need(flags, 'lifetime', E), tok = adminToken(flags, E);
  if (!LIFETIMES.has(lifetime)) throw new E('--lifetime must be one of today|48h|7d|indefinite');
  const body = await call(rt, '/api/remote-ant/admit',
    { method: 'POST', headers: adminH(tok), body: JSON.stringify({ roomId: room, lifetimePreset: lifetime }) }, [tok]);
  if (!body) return 1;
  emit(rt, body, flags.json !== undefined,
    (p) => `code: ${p.code}\nadmission_id: ${p.admission.id}\naccept_by_ms: ${p.admission.expires_acceptance_at_ms}`);
  return 0;
}
async function runRedeem(flags, rt, E) {
  const code = need(flags, 'code', E), admId = need(flags, 'admission-id', E);
  const url = need(flags, 'remote-url', E), label = need(flags, 'label', E);
  if (flags.direction !== undefined && !DIRECTIONS.has(flags.direction)) throw new E('--direction must be in|out|both');
  const body = { code, remoteInstanceLabel: label };
  if (flags.direction !== undefined) body.direction = flags.direction;
  const res = await rt.fetchImpl(`${url}/api/remote-ant/admissions/${encodeURIComponent(admId)}/redeem`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { rt.writeErr(`Request failed (${res.status})`); return 1; }
  const p = await res.json();
  emit(rt, p, flags.json !== undefined, (p) => `mapping_id: ${p.mapping.id}\nbridge_token: ${p.bridge_token}`);
  return 0;
}
async function runMapping(pos, flags, rt, E) {
  const sub = pos[0], tok = adminToken(flags, E);
  if (sub === 'list') {
    const room = need(flags, 'room', E);
    const body = await call(rt, `/api/remote-ant/mappings?roomId=${encodeURIComponent(room)}`,
      { headers: { authorization: `Bearer ${tok}` } }, [tok]);
    if (!body) return 1;
    emit(rt, body, flags.json !== undefined,
      (p) => p.mappings.map((m) => `${m.id}\t${m.remote_instance_label}\t${m.direction}\tlast_seen=${m.last_seen_at_ms ?? '-'}`).join('\n'));
    return 0;
  }
  const mid = pos[1];
  if (!mid) throw new E(`mapping ${sub ?? ''} needs a MAPPING_ID`);
  if (sub === 'show') {
    const body = await call(rt, `/api/remote-ant/mappings/${encodeURIComponent(mid)}`,
      { headers: { authorization: `Bearer ${tok}` } }, [tok]);
    if (!body) return 1;
    emit(rt, body, flags.json !== undefined, (p) => JSON.stringify(p.mapping, null, 2));
    return 0;
  }
  if (sub === 'revoke') {
    const body = await call(rt, `/api/remote-ant/mappings/${encodeURIComponent(mid)}/revoke`,
      { method: 'POST', headers: { authorization: `Bearer ${tok}` } }, [tok]);
    if (!body) return 1;
    emit(rt, body, flags.json !== undefined, (p) => `revoked: ${p.mapping_id}`);
    return 0;
  }
  throw new E(`unknown mapping subverb: ${sub}`);
}
async function runRoomSend(pos, flags, rt, E) {
  const mid = pos[0]; if (!mid) throw new E('remote-room send needs a MAPPING_ID');
  const msg = need(flags, 'msg', E), tok = adminToken(flags, E);
  const body = await call(rt, `/api/remote-ant/mappings/${encodeURIComponent(mid)}/send`,
    { method: 'POST', headers: adminH(tok), body: JSON.stringify({ kind: 'message', payloadJson: JSON.stringify({ body: msg }) }) }, [tok]);
  if (!body) return 1;
  emit(rt, body, flags.json !== undefined,
    (p) => `event: ${p.event.id}\tstatus: ${p.event.status}\tdelivery: ${p.event.delivery_state}`);
  return 0;
}
async function runRoomStatus(pos, flags, rt, E) {
  // v2 (M4 v2 count surface): try /status first, fall back to /mappings/:id on failure.
  const mid = pos[0]; if (!mid) throw new E('remote-room status needs a MAPPING_ID');
  const tok = adminToken(flags, E);
  const v2 = await rt.fetchImpl(`${rt.serverUrl}/api/remote-ant/mappings/${encodeURIComponent(mid)}/status`,
    { headers: { authorization: `Bearer ${tok}` } });
  if (v2.ok) {
    const body = await v2.json();
    if (body && body.counts && body.mapping) {
      emit(rt, body, flags.json !== undefined,
        (p) => `${p.mapping.id}\tlabel=${p.mapping.remote_instance_label}\tlast_seen=${p.mapping.last_seen_at_ms ?? '-'}\taccepted=${p.counts.accepted}\tquarantined=${p.counts.quarantined}\tdelivered=${p.counts.delivered}\tpending=${p.counts.pending}\tfailed=${p.counts.failed}`);
      return 0;
    }
  }
  // Fallback to v1 mapping-detail when v2 endpoint missing/disabled.
  const body = await call(rt, `/api/remote-ant/mappings/${encodeURIComponent(mid)}`,
    { headers: { authorization: `Bearer ${tok}` } }, [tok]);
  if (!body) return 1;
  emit(rt, body, flags.json !== undefined,
    (p) => `${p.mapping.id}\tlabel=${p.mapping.remote_instance_label}\tlast_seen=${p.mapping.last_seen_at_ms ?? '-'}\trevoked=${p.mapping.revoked_at_ms ?? '-'}`);
  return 0;
}
async function runRoomAck(pos, flags, rt, E) {
  const ev = pos[0]; if (!ev) throw new E('remote-room ack needs an EVENT_ID');
  const tok = adminToken(flags, E);
  const body = await call(rt, '/api/remote-ant/quarantine',
    { method: 'POST', headers: adminH(tok), body: JSON.stringify({ eventId: ev }) }, [tok]);
  if (!body) return 1;
  emit(rt, body, flags.json !== undefined, (p) => `acked: ${p.event_id}`);
  return 0;
}
async function runRoomQuarantine(pos, flags, rt, E) {
  if (pos[0] !== 'list') throw new E(`unknown quarantine subverb: ${pos[0]}`);
  const tok = adminToken(flags, E);
  const f = flags['mapping-id'] !== undefined ? `?mappingId=${encodeURIComponent(flags['mapping-id'])}` : '';
  const body = await call(rt, `/api/remote-ant/quarantine${f}`,
    { headers: { authorization: `Bearer ${tok}` } }, [tok]);
  if (!body) return 1;
  emit(rt, body, flags.json !== undefined,
    (p) => p.events.length === 0 ? '(no quarantined events)'
      : p.events.map((e) => `${e.id}\t${e.mapping_id}\t${e.direction}\t${e.kind}\treason=${e.status_reason ?? '-'}`).join('\n'));
  return 0;
}
