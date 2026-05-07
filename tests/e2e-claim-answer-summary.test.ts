// M5 #3 — E2E test scaffold: claim → answer → publish-summary loop
// Exercises the full interview workflow with WS-broadcast assertion and
// the fresh-workspace pattern from upload-hardening.test.ts.
//
// Flow:
//   1. Create terminal + chat sessions, set up interview link
//   2. Create a task and claim it (PATCH assigned_to)
//   3. Post a message that triggers ask fan-out
//   4. Resolve the asks via PATCH /messages/:msg_id/asks
//   5. Build a publish-summary via the pure helper
//   6. Verify WS broadcasts at claim, message, and ask-resolution stages

import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTest as resetDbForTest } from '../src/lib/server/db.js';

const originalCwd = process.cwd();
const originalAntDataDir = process.env.ANT_DATA_DIR;
const tempDirs: string[] = [];

async function freshWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'ant-e2e-test-'));
  tempDirs.push(dir);
  process.env.ANT_DATA_DIR = join(dir, 'data');
  process.chdir(dir);
  resetDbForTest();
  const db = (await import('../src/lib/server/db.js')).default();
  const queries = (await import('../src/lib/server/db.js')).queries;
  const tasksRoute = await import('../src/routes/api/sessions/[id]/tasks/+server.js');
  const taskDetailRoute = await import('../src/routes/api/sessions/[id]/tasks/[taskId]/+server.js');
  const messagesRoute = await import('../src/routes/api/sessions/[id]/messages/+server.js');
  const asksRoute = await import('../src/routes/api/sessions/[id]/messages/[msg_id]/asks/+server.js');
  const startInterviewRoute = await import('../src/routes/api/sessions/[id]/start-interview/+server.js');
  const wsBroadcast = await import('../src/lib/server/ws-broadcast.js');
  const { buildPublishSummary } = await import('../src/lib/server/interview/publish-summary.js');
  return {
    dir,
    db,
    queries,
    tasksRoute,
    taskDetailRoute,
    messagesRoute,
    asksRoute,
    startInterviewRoute,
    wsBroadcast,
    buildPublishSummary,
  };
}

function makeEvent(
  sessionId: string,
  routePath: string,
  options: { method?: string; body?: unknown; params?: Record<string, string> } = {},
) {
  const url = `http://localhost${routePath.replace('[id]', sessionId)}`;
  const request = new Request(url, {
    method: options.method ?? 'POST',
    headers: options.body !== undefined ? { 'content-type': 'application/json' } : {},
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  // start-interview's POST handler dispatches participant pre-invitations via
  // event.fetch — stub it to a 200-OK no-op so the test doesn't try to make
  // real HTTP calls.
  const stubFetch: typeof fetch = async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  return {
    params: { id: sessionId, ...(options.params ?? {}) },
    request,
    url: new URL(url),
    locals: {},
    fetch: stubFetch,
  } as any;
}

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalAntDataDir === undefined) delete process.env.ANT_DATA_DIR;
  else process.env.ANT_DATA_DIR = originalAntDataDir;
  resetDbForTest();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('E2E: claim → answer → publish-summary', () => {
  it('full lifecycle: create sessions, interview, claim task, answer asks, publish summary', async () => {
    const ctx = await freshWorkspace();

    // ── Register a fake WS client to capture broadcasts ──────────────
    const capturedBroadcasts: any[] = [];
    const clientKey = Symbol('e2e-test-client');
    ctx.wsBroadcast.registerClient(clientKey, {
      sessionId: undefined,
      sessionIds: new Set(),
      handle: null,
      send: (msg: string) => {
        try { capturedBroadcasts.push(JSON.parse(msg)); } catch {}
      },
      readyState: 1, // OPEN
    });

    // ── 1. Create sessions ───────────────────────────────────────────
    ctx.queries.createSession('t-james', 'James terminal', 'terminal', 'forever', null, null, '{}');
    ctx.queries.setHandle('t-james', '@james', 'James');
    ctx.queries.createSession('room-1', 'Planning room', 'chat', 'forever', null, null, '{}');

    // Join the fake client to both sessions
    ctx.wsBroadcast.joinClientSession(clientKey, 't-james', '@james');
    ctx.wsBroadcast.joinClientSession(clientKey, 'room-1', '@james');

    // ── 2. Start interview ───────────────────────────────────────────
    const interviewResp = await ctx.startInterviewRoute.POST(
      makeEvent('t-james', '/api/sessions/[id]/start-interview', {
        body: { origin_room_id: 'room-1', caller_handle: '@james' },
      }),
    );
    expect(interviewResp.status).toBe(200);
    const interview = await interviewResp.json();
    expect(interview.ok).toBe(true);

    // ── 3. Create and claim a task ───────────────────────────────────
    capturedBroadcasts.length = 0;
    const createTaskResp = await ctx.tasksRoute.POST(
      makeEvent('room-1', '/api/sessions/[id]/tasks', {
        body: { title: 'Audit file-read permissions' },
      }),
    );
    expect(createTaskResp.status).toBe(201);
    const { task } = await createTaskResp.json();
    expect(task.title).toBe('Audit file-read permissions');

    // Claim the task by assigning it
    const claimResp = await ctx.taskDetailRoute.PATCH(
      makeEvent('room-1', '/api/sessions/[id]/tasks/[taskId]', {
        method: 'PATCH',
        body: { assigned_to: '@james', status: 'in_progress' },
        params: { taskId: task.id },
      }),
    );
    expect(claimResp.status).toBe(200);
    const claimed = await claimResp.json();
    expect(claimed.task.assigned_to).toBe('@james');
    expect(claimed.task.status).toBe('in_progress');

    // Verify WS broadcast for claim
    const claimBroadcast = capturedBroadcasts.find((m: any) => m.type === 'task_updated');
    expect(claimBroadcast).toBeDefined();
    expect(claimBroadcast.sessionId).toBe('room-1');

    // ── 4. Post a message that creates asks ──────────────────────────
    capturedBroadcasts.length = 0;
    const msgResp = await ctx.messagesRoute.POST(
      makeEvent('room-1', '/api/sessions/[id]/messages', {
        body: {
          role: 'human', content: 'Should we allow file-read on *.ts files? What about web-fetch to npmjs.com?',
          msg_type: 'chat',
          asks: [
            'Allow file-read on *.ts files?',
            'Allow web-fetch to npmjs.com?',
          ],
        },
      }),
    );
    expect(msgResp.status).toBe(201);
    const msg = await msgResp.json();
    expect(msg.content).toContain('file-read');

    // Verify WS broadcast for message creation
    const askBroadcast = capturedBroadcasts.find((m: any) => m.type === 'ask_created');
    expect(askBroadcast).toBeDefined();

    // ── 5. Get the asks that were auto-created ───────────────────────
    const asks = ctx.queries.listAsks({ sessionId: 'room-1' });
    expect(asks.length).toBeGreaterThanOrEqual(2);

    // ── 6. Resolve the asks ──────────────────────────────────────────
    capturedBroadcasts.length = 0;
    const resolveResp = await ctx.asksRoute.PATCH(
      makeEvent('room-1', '/api/sessions/[id]/messages/[msg_id]/asks', {
        method: 'PATCH',
        body: { resolved: [0, 1] },
        params: { msg_id: msg.id },
      }),
    );
    expect(resolveResp.status).toBe(200);

    // Verify WS broadcasts for ask resolution
    const askUpdatedBroadcasts = capturedBroadcasts.filter((m: any) => m.type === 'ask_updated');
    expect(askUpdatedBroadcasts.length).toBeGreaterThanOrEqual(2);

    // Verify asks are now answered
    const askIds: string[] = Array.isArray(JSON.parse(msg.meta || '{}').ask_ids)
      ? JSON.parse(msg.meta).ask_ids : [];
    for (const askId of askIds) {
      const ask = ctx.queries.getAsk(askId);
      if (ask) {
        expect(ask.status).toBe('answered');
      }
    }

    // ── 7. Build publish-summary via pure helper ─────────────────────
    const summarySources = asks
      .filter((a: any) => a.source_message_id)
      .map((a: any) => ({ message_id: a.source_message_id, excerpt: a.title }));

    const summary = ctx.buildPublishSummary({
      title: 'Interview summary: permissions audit',
      findings: ['File-read on *.ts is low-risk', 'Web-fetch to npmjs needs rate-limiting'],
      decisions: ['Grant file-read on *.ts for 24h'],
      asks: ['Allow file-read on *.ts?', 'Allow web-fetch to npmjs.com?'],
      actions: ['Configure web-fetch rate limits'],
      sources: summarySources,
      linkedChatId: interview.chat_id,
      originRoomId: 'room-1',
      authoredBy: '@james',
    });

    expect(summary.schema_version).toBe(1);
    expect(summary.title).toBe('Interview summary: permissions audit');
    expect(summary.findings).toHaveLength(2);
    expect(summary.decisions).toHaveLength(1);
    expect(summary.asks).toHaveLength(2);
    expect(summary.actions).toHaveLength(1);
    expect(summary.linked_chat_id).toBe(interview.chat_id);
    expect(summary.origin_room_id).toBe('room-1');

    // ── 8. Confirm interview chat integrity ──────────────────────────
    const linkedChat = ctx.queries.getSession(interview.chat_id);
    expect(linkedChat).toBeTruthy();
    expect(linkedChat.type).toBe('chat');
    const chatMeta = JSON.parse(linkedChat.meta || '{}');
    expect(chatMeta.interview).toBe(true);
  });

  it('WS broadcasts task_created and task_updated events for room participants', async () => {
    const ctx = await freshWorkspace();

    const captured: any[] = [];
    const key = Symbol('ws-test');
    ctx.wsBroadcast.registerClient(key, {
      sessionIds: new Set(),
      handle: null,
      send: (msg: string) => { try { captured.push(JSON.parse(msg)); } catch {} },
      readyState: 1,
    });

    ctx.queries.createSession('s-room', 'Audit room', 'chat', 'forever', null, null, '{}');
    ctx.wsBroadcast.joinClientSession(key, 's-room', '@auditor');

    // Create task
    captured.length = 0;
    const resp = await ctx.tasksRoute.POST(
      makeEvent('s-room', '/api/sessions/[id]/tasks', {
        body: { title: 'Review consent scope' },
      }),
    );
    expect(resp.status).toBe(201);
    const { task: t } = await resp.json();

    const createdEvent = captured.find((m: any) => m.type === 'task_created');
    expect(createdEvent).toBeDefined();
    expect(createdEvent.task.title).toBe('Review consent scope');

    // Claim task
    captured.length = 0;
    await ctx.taskDetailRoute.PATCH(
      makeEvent('s-room', '/api/sessions/[id]/tasks/[taskId]', {
        method: 'PATCH',
        body: { assigned_to: '@auditor', status: 'in_progress' },
        params: { taskId: t.id },
      }),
    );

    const updatedEvent = captured.find((m: any) => m.type === 'task_updated');
    expect(updatedEvent).toBeDefined();
    expect(updatedEvent.task.assigned_to).toBe('@auditor');
    expect(updatedEvent.task.status).toBe('in_progress');
  });

  it('fresh workspace is isolated: no sessions leak between test cases', async () => {
    const ctx1 = await freshWorkspace();
    ctx1.queries.createSession('s-isolated', 'Isolated', 'terminal', 'forever', null, null, '{}');
    expect(ctx1.queries.getSession('s-isolated')).toBeTruthy();

    const ctx2 = await freshWorkspace();
    expect(ctx2.queries.getSession('s-isolated')).toBeFalsy();
    ctx2.queries.createSession('s-other', 'Other', 'chat', 'forever', null, null, '{}');
    expect(ctx2.queries.getSession('s-other')).toBeTruthy();
  });
});
