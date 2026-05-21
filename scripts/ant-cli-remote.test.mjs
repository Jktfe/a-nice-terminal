// Tests for ant-cli-remote.mjs (M4 T3). Bun-test harness — scripts/*.test.mjs
// is outside default vitest include (Option X tooling gap). Coverage per
// docs/m4-t3-gate-bars-2026-05-14.md.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleRemoteVerb, handleRemoteRoomVerb } from './ant-cli-remote.mjs';
import { makeCliRunner } from './ant-cli.mjs';
class CliInputError extends Error {}
const ctx = { CliInputError };
const PREV = process.env.ANT_ADMIN_TOKEN;
beforeEach(() => { process.env.ANT_ADMIN_TOKEN = 'admin-T3-tok'; });
afterEach(() => {
  if (PREV === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV;
});
function jsonRes(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}
function makeRuntime(replies = []) {
  const calls = [], stdout = [], stderr = [];
  let i = 0;
  return {
    fetchImpl: async (url, init) => { calls.push({ url, init }); const r = replies[i++]; return r ?? jsonRes({}, 500); },
    writeOut: (l) => stdout.push(l), writeErr: (l) => stderr.push(l),
    serverUrl: 'http://127.0.0.1:6174', stdout, stderr, calls
  };
}
describe('ant remote admit', () => {
  it('POSTs roomId+lifetimePreset with admin bearer and prints code+admission_id', async () => {
    const rt = makeRuntime([jsonRes({ admission: { id: 'adm_1', expires_acceptance_at_ms: 99 }, code: 'ANT-XXX-YYYY' }, 201)]);
    const code = await handleRemoteVerb('admit', ['--room', 'r1', '--lifetime', '48h'], rt, ctx);
    expect(code).toBe(0);
    expect(rt.calls[0].url).toBe('http://127.0.0.1:6174/api/remote-ant/admit');
    expect(rt.calls[0].init.headers.authorization).toBe('Bearer admin-T3-tok');
    expect(JSON.parse(rt.calls[0].init.body)).toEqual({ roomId: 'r1', lifetimePreset: '48h' });
    expect(rt.stdout.join('\n')).toContain('code: ANT-XXX-YYYY');
    expect(rt.stdout.join('\n')).toContain('adm_1');
  });
  it('--json prints raw payload', async () => {
    const payload = { admission: { id: 'a', expires_acceptance_at_ms: 1 }, code: 'C' };
    const rt = makeRuntime([jsonRes(payload, 201)]);
    await handleRemoteVerb('admit', ['--room', 'r', '--lifetime', '48h', '--json'], rt, ctx);
    expect(rt.stdout[0]).toBe(JSON.stringify(payload));
  });
  it('rejects missing --room before fetch', async () => {
    const rt = makeRuntime([]);
    await expect(handleRemoteVerb('admit', ['--lifetime', '48h'], rt, ctx)).rejects.toBeInstanceOf(CliInputError);
    expect(rt.calls.length).toBe(0);
  });
  it('rejects missing admin token before fetch', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const rt = makeRuntime([]);
    await expect(handleRemoteVerb('admit', ['--room', 'r', '--lifetime', '48h'], rt, ctx)).rejects.toBeInstanceOf(CliInputError);
    expect(rt.calls.length).toBe(0);
  });
  it('B3: rejects unknown --lifetime before fetch', async () => {
    const rt = makeRuntime([]);
    await expect(handleRemoteVerb('admit', ['--room', 'r', '--lifetime', '99y'], rt, ctx)).rejects.toBeInstanceOf(CliInputError);
    expect(rt.calls.length).toBe(0);
  });
});
describe('ant remote redeem', () => {
  it('POSTs to remote-url + prints mapping_id + bridge_token', async () => {
    const rt = makeRuntime([jsonRes({ mapping: { id: 'map_1' }, bridge_token: 'rbt_xyz' }, 201)]);
    const code = await handleRemoteVerb('redeem',
      ['--code', 'ANT-A-B', '--admission-id', 'adm_x', '--remote-url', 'http://remote.local:6174', '--label', 'inst'],
      rt, ctx);
    expect(code).toBe(0);
    expect(rt.calls[0].url).toBe('http://remote.local:6174/api/remote-ant/admissions/adm_x/redeem');
    expect(JSON.parse(rt.calls[0].init.body)).toEqual({ code: 'ANT-A-B', remoteInstanceLabel: 'inst' });
    expect(rt.stdout.join('\n')).toContain('mapping_id: map_1');
    expect(rt.stdout.join('\n')).toContain('bridge_token: rbt_xyz');
  });
  it('honours --direction in the body', async () => {
    const rt = makeRuntime([jsonRes({ mapping: { id: 'm' }, bridge_token: 'r' }, 201)]);
    await handleRemoteVerb('redeem',
      ['--code', 'C', '--admission-id', 'a', '--remote-url', 'http://x', '--label', 'l', '--direction', 'in'], rt, ctx);
    expect(JSON.parse(rt.calls[0].init.body).direction).toBe('in');
  });
  it('rejects missing --code', async () => {
    const rt = makeRuntime([]);
    await expect(handleRemoteVerb('redeem',
      ['--admission-id', 'a', '--remote-url', 'http://x', '--label', 'l'], rt, ctx)).rejects.toBeInstanceOf(CliInputError);
  });
  it('B3: rejects bad --direction before fetch', async () => {
    const rt = makeRuntime([]);
    await expect(handleRemoteVerb('redeem',
      ['--code', 'C', '--admission-id', 'a', '--remote-url', 'http://x', '--label', 'l', '--direction', 'sideways'], rt, ctx))
      .rejects.toBeInstanceOf(CliInputError);
    expect(rt.calls.length).toBe(0);
  });
  it('410 surfaces as exit 1 + stderr', async () => {
    const rt = makeRuntime([jsonRes({ message: 'gone' }, 410)]);
    const code = await handleRemoteVerb('redeem',
      ['--code', 'C', '--admission-id', 'a', '--remote-url', 'http://x', '--label', 'l'], rt, ctx);
    expect(code).toBe(1);
    expect(rt.stderr.join('\n')).toContain('410');
  });
});
describe('ant remote mapping', () => {
  it('list: GET /mappings?roomId=R + admin bearer', async () => {
    const rt = makeRuntime([jsonRes({ mappings: [{ id: 'm1', remote_instance_label: 'inst', direction: 'both', last_seen_at_ms: null }] })]);
    await handleRemoteVerb('mapping', ['list', '--room', 'r1'], rt, ctx);
    expect(rt.calls[0].url).toContain('/api/remote-ant/mappings?roomId=r1');
    expect(rt.calls[0].init.headers.authorization).toBe('Bearer admin-T3-tok');
    expect(rt.stdout.join('\n')).toContain('m1');
  });
  it('show: GET /mappings/:id', async () => {
    const rt = makeRuntime([jsonRes({ mapping: { id: 'm1', remote_instance_label: 'inst' } })]);
    await handleRemoteVerb('mapping', ['show', 'm1'], rt, ctx);
    expect(rt.calls[0].url).toContain('/api/remote-ant/mappings/m1');
  });
  it('revoke: POST /mappings/:id/revoke', async () => {
    const rt = makeRuntime([jsonRes({ revoked: true, mapping_id: 'm1' })]);
    await handleRemoteVerb('mapping', ['revoke', 'm1'], rt, ctx);
    expect(rt.calls[0].init.method).toBe('POST');
    expect(rt.calls[0].url).toContain('/api/remote-ant/mappings/m1/revoke');
    expect(rt.stdout.join('\n')).toContain('revoked: m1');
  });
  it('list: rejects missing --room', async () => { await expect(handleRemoteVerb('mapping', ['list'], makeRuntime([]), ctx)).rejects.toBeInstanceOf(CliInputError); });
  it('show: rejects missing MAPPING_ID', async () => { await expect(handleRemoteVerb('mapping', ['show'], makeRuntime([]), ctx)).rejects.toBeInstanceOf(CliInputError); });
});
describe('ant remote-room send', () => {
  it('POSTs /mappings/:id/send with admin bearer + kind+payloadJson', async () => {
    const rt = makeRuntime([jsonRes({ event: { id: 'e1', status: 'accepted', delivery_state: 'pending' } }, 201)]);
    await handleRemoteRoomVerb('send', ['m1', '--msg', 'hi'], rt, ctx);
    expect(rt.calls[0].url).toContain('/api/remote-ant/mappings/m1/send');
    expect(rt.calls[0].init.method).toBe('POST');
    const body = JSON.parse(rt.calls[0].init.body);
    expect(body.kind).toBe('message');
    expect(JSON.parse(body.payloadJson)).toEqual({ body: 'hi' });
  });
  it('rejects missing MAPPING_ID', async () => { await expect(handleRemoteRoomVerb('send', ['--msg', 'x'], makeRuntime([]), ctx)).rejects.toBeInstanceOf(CliInputError); });
});
describe('ant remote-room status (M4 v2 count surface + v1 fallback)', () => {
  it('v2 happy: prints counts when /status returns mapping+counts', async () => {
    const rt = makeRuntime([jsonRes({ mapping: { id: 'm1', remote_instance_label: 'inst', last_seen_at_ms: 12345 }, counts: { accepted: 5, quarantined: 1, delivered: 3, pending: 2, failed: 0 } })]);
    await handleRemoteRoomVerb('status', ['m1'], rt, ctx);
    expect(rt.calls[0].url).toContain('/m1/status');
    const out = rt.stdout.join('\n');
    expect(out).toContain('last_seen=12345'); expect(out).toContain('accepted=5'); expect(out).toContain('quarantined=1');
  });
  it('v1 fallback: 404 on /status falls back to /mappings/:id', async () => {
    const rt = makeRuntime([jsonRes({}, 404), jsonRes({ mapping: { id: 'm1', remote_instance_label: 'inst', last_seen_at_ms: 12345, revoked_at_ms: null } })]);
    await handleRemoteRoomVerb('status', ['m1'], rt, ctx);
    expect(rt.calls[0].url).toContain('/m1/status');
    expect(rt.calls[1].url).toBe('http://127.0.0.1:6174/api/remote-ant/mappings/m1');
    expect(rt.stdout.join('\n')).toContain('last_seen=12345');
  });
});
describe('ant remote-room ack', () => {
  it('POSTs /quarantine with eventId', async () => {
    const rt = makeRuntime([jsonRes({ acked: true, event_id: 'e1' })]);
    await handleRemoteRoomVerb('ack', ['e1'], rt, ctx);
    expect(rt.calls[0].url).toContain('/api/remote-ant/quarantine');
    expect(JSON.parse(rt.calls[0].init.body)).toEqual({ eventId: 'e1' });
  });
});
describe('ant remote-room quarantine list', () => {
  it('GETs /quarantine without filter when --mapping-id absent', async () => {
    const rt = makeRuntime([jsonRes({ events: [] })]);
    await handleRemoteRoomVerb('quarantine', ['list'], rt, ctx);
    expect(rt.calls[0].url).toBe('http://127.0.0.1:6174/api/remote-ant/quarantine');
    expect(rt.stdout[0]).toContain('(no quarantined events)');
  });
  it('encodes --mapping-id query param when set', async () => {
    const rt = makeRuntime([jsonRes({ events: [{ id: 'e', mapping_id: 'm', direction: 'in', kind: 'message', status_reason: 'replay_collision' }] })]);
    await handleRemoteRoomVerb('quarantine', ['list', '--mapping-id', 'm-xyz'], rt, ctx);
    expect(rt.calls[0].url).toContain('?mappingId=m-xyz');
    expect(rt.stdout[0]).toContain('reason=replay_collision');
  });
});
describe('main runner dispatch (T3-C0)', () => {
  function setupRunner(replies) {
    const rt = makeRuntime(replies);
    const runner = makeCliRunner({ fetchImpl: rt.fetchImpl, writeOut: rt.writeOut, writeErr: rt.writeErr, serverUrl: rt.serverUrl });
    return { runner, rt };
  }
  it('dispatches ant remote help via main runner', async () => {
    const { runner, rt } = setupRunner([]);
    const code = await runner.run(['remote', 'help']);
    expect(code).toBe(0);
    expect(rt.stdout.join('\n')).toContain('ant remote <admit|redeem|mapping>');
  });
  it('dispatches ant remote-room help via main runner (kebab→camel handler key)', async () => {
    const { runner, rt } = setupRunner([]);
    const code = await runner.run(['remote-room', 'help']);
    expect(code).toBe(0);
    expect(rt.stdout.join('\n')).toContain('ant remote-room');
  });
  it('main help advertises remote + remote-room', async () => {
    const { runner, rt } = setupRunner([]);
    await runner.run(['help']);
    const help = rt.stdout.join('\n');
    expect(help).toContain('remote admit|redeem|mapping');
    expect(help).toContain('remote-room send|status|ack|quarantine');
  });
});
