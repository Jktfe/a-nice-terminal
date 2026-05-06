// ANT — Claude Code Hook Receiver
//
// POST /api/hooks
//
// Receives events from Claude Code hooks (Notification, TaskCreated,
// TaskCompleted, PostToolUse, etc.) and routes them to the appropriate
// ANT session's linked chat as agent_event messages.
//
// The hook scripts POST here with the raw Claude Code event JSON plus
// an `ant_session_id` field identifying which ANT terminal session
// originated the event.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { broadcast, broadcastGlobal } from '$lib/server/ws-broadcast';
import { nanoid } from 'nanoid';

function normalizeRunEvent(row: any) {
  if (!row) return null;
  let payload: unknown = {};
  try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {}); }
  catch { payload = {}; }
  return {
    id: row.id,
    session_id: row.session_id,
    ts: row.ts_ms,
    ts_ms: row.ts_ms,
    source: row.source,
    trust: row.trust,
    kind: row.kind,
    text: row.text ?? '',
    payload,
    raw_ref: row.raw_ref ?? null,
    created_at: row.created_at,
  };
}

// PostToolUse → run_event kind mapping. The Plan View capture-coverage test
// expects `command_block` for shell-execution tools and `file_write` for
// file-mutation tools, so a Bash hook lands beside ant.zsh's command_block
// rows on the same timeline, and Edit/Write/MultiEdit/NotebookEdit get
// their own first-class kind for downstream consumers.
const FILE_WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function toolName(body: any): string | null {
  return body.tool_name || body.tool?.name || (typeof body.tool === 'string' ? body.tool : null) || body.name || null;
}

function hookKind(event: string, body: any): string {
  const notifType = body.notification_type || '';
  if (notifType === 'permission_prompt') return 'permission';
  if (event === 'Notification') return 'question';
  if (event === 'BeforeTool' || event === 'PreToolUse') return 'tool_call';
  if (event === 'AfterTool' || event === 'PostToolUse') {
    const tool = toolName(body);
    if (tool === 'Bash') return 'command_block';
    if (tool && FILE_WRITE_TOOLS.has(tool)) return 'file_write';
    return 'tool_result';
  }
  if (event === 'TaskCreated' || event === 'TaskCompleted') return 'progress';
  if (event === 'SessionStart' || event === 'SessionEnd' || event === 'Stop' || event === 'AfterAgent') return 'status';
  if (/error|fail/i.test(event)) return 'error';
  return 'system';
}

function hookText(agent: string, event: string, body: any): string {
  const tool = toolName(body);
  if (tool && (event === 'BeforeTool' || event === 'PreToolUse')) return `${agent} running ${tool}`;
  if (event === 'AfterTool' || event === 'PostToolUse') {
    const input = body.tool_input || {};
    if (tool === 'Bash' && typeof input.command === 'string') return input.command;
    if (tool && FILE_WRITE_TOOLS.has(tool) && typeof input.file_path === 'string') return `${tool} ${input.file_path}`;
    if (tool) return `${agent} finished ${tool}`;
  }
  if (event === 'Notification') return body.message || `${agent} waiting for input`;
  if (event === 'TaskCreated') return `Task created: ${body.task_name || body.description || 'Unnamed task'}`;
  if (event === 'TaskCompleted') return `Task completed: ${body.task_name || body.description || 'Unnamed task'}`;
  if (event === 'Stop') return `${agent} stopped (${body.stop_reason || 'end_turn'})`;
  return `${agent} hook: ${event}`;
}

function buildHookPayload(kind: string, agent: string, event: string, body: any): Record<string, unknown> {
  const tool = toolName(body);
  const input = body.tool_input || {};
  const response = body.tool_response || {};

  if (kind === 'command_block') {
    return {
      command: typeof input.command === 'string' ? input.command : '',
      exit_code: typeof response.exitCode === 'number' ? response.exitCode
        : typeof response.exit_code === 'number' ? response.exit_code
        : null,
      cwd: typeof body.cwd === 'string' ? body.cwd : null,
      duration_ms: typeof response.duration_ms === 'number' ? response.duration_ms : null,
      started_at: typeof body.started_at === 'string' ? body.started_at : null,
      ended_at: new Date().toISOString(),
      source_event: 'PostToolUse',
      agent,
      tool,
    };
  }

  if (kind === 'file_write') {
    return {
      tool,
      file_path: typeof input.file_path === 'string' ? input.file_path : null,
      action: tool === 'Write' ? 'write' : tool === 'Edit' ? 'edit' : tool === 'MultiEdit' ? 'multi_edit' : tool === 'NotebookEdit' ? 'notebook_edit' : 'unknown',
      success: response.success !== undefined ? Boolean(response.success) : null,
      replace_all: input.replace_all === true ? true : undefined,
      source_event: 'PostToolUse',
      agent,
    };
  }

  return { agent, event, body };
}

function appendHookRunEvent(sessionId: string, agent: string, event: string, body: any) {
  try {
    const kind = hookKind(event, body);
    const row = queries.appendRunEvent(
      sessionId,
      Date.now(),
      'hook',
      'high',
      kind,
      hookText(agent, event, body).slice(0, 12_000),
      JSON.stringify(buildHookPayload(kind, agent, event, body)),
      null,
    );
    const runEvent = normalizeRunEvent(row);
    if (runEvent) broadcast(sessionId, { type: 'run_event_created', sessionId, event: runEvent });
  } catch {}
}

export async function POST({ request }: RequestEvent) {
  let body: any;
  try { body = await request.json(); } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }

  const agent = body.agent || 'claude-code';
  const event = body.hook_event_name || body.event;
  const sessionId = body.ant_session_id;

  if (!event) return json({ error: 'event name required (hook_event_name or event)' }, { status: 400 });

  // Find the linked chat for this session (if any)
  let chatId: string | null = null;
  if (sessionId) {
    const session: any = queries.getSession(sessionId);
    chatId = session?.linked_chat_id ?? null;

    // Mark session as hook-enabled in metadata if not already
    let meta: any = {};
    try { meta = typeof session.meta === 'string' ? JSON.parse(session.meta) : (session.meta ?? {}); } catch {}
    if (!meta.hooks_active) {
      meta.hooks_active = true;
      queries.updateSession(null, null, null, JSON.stringify(meta), sessionId);
    }
  }

  const { getRouter } = await import('$lib/server/message-router.js');
  const router = getRouter();

  if (sessionId) {
    appendHookRunEvent(sessionId, agent, event, body);
  }

  // ─── Route by Agent & Event Type ──────────────────────────────────────

  // --- Gemini CLI Hooks ---
  if (agent === 'gemini-cli') {
    if (event === 'SessionStart') {
      const initialPrompt = body.initial_prompt || body.prompt || 'Gemini Task';
      if (sessionId) {
        try {
          queries.createTask(nanoid(), sessionId, 'gemini-cli', initialPrompt, null);
        } catch {}
      }

      if (chatId) {
        const id = nanoid();
        const text = `🚀 Gemini session started: ${initialPrompt}`;
        queries.createMessage(id, chatId, 'assistant', text, 'text', 'complete', sessionId, null, null, 'message', '{}');
        await router.route({
          id, sessionId: chatId, content: text, role: 'assistant',
          senderId: sessionId, senderName: 'Gemini', senderType: 'terminal',
          target: null, replyTo: null, msgType: 'message'
        });
      }
      return json({ ok: true, event });
    }

    if (event === 'BeforeTool') {
      if (chatId) {
        const toolName = body.tool_name || 'a tool';
        const content = JSON.stringify({
          class: 'thinking',
          payload: { status: `Running ${toolName}...` },
          text: `Gemini is running ${toolName}`,
        });
        const id = nanoid();
        queries.createMessage(id, chatId, 'assistant', content, 'text', 'complete', sessionId, null, null, 'agent_event', '{}');
        await router.route({
          id, sessionId: chatId, content, role: 'assistant',
          senderId: sessionId, senderName: 'Gemini', senderType: 'terminal',
          target: null, replyTo: null, msgType: 'agent_event'
        });
      }
      return json({ ok: true, event });
    }

    if (event === 'AfterTool') {
      if (chatId) {
        const toolName = body.tool_name || 'tool';
        const exitCode = body.exit_code;
        const text = `⚙️ Gemini: ${toolName} finished${exitCode !== undefined ? ` (exit: ${exitCode})` : ''}`;
        
        // Also clear thinking status
        const content = JSON.stringify({
          class: 'thinking',
          payload: { status: null },
          text: `Gemini finished ${toolName}`,
        });

        const id1 = nanoid();
        queries.createMessage(id1, chatId, 'assistant', text, 'text', 'complete', sessionId, null, null, 'message', '{}');
        const id2 = nanoid();
        queries.createMessage(id2, chatId, 'assistant', content, 'text', 'complete', sessionId, null, null, 'agent_event', '{}');

        await router.route({
          id: id1, sessionId: chatId, content: text, role: 'assistant',
          senderId: sessionId, senderName: 'Gemini', senderType: 'terminal',
          target: null, replyTo: null, msgType: 'message'
        });
        await router.route({
          id: id2, sessionId: chatId, content, role: 'assistant',
          senderId: sessionId, senderName: 'Gemini', senderType: 'terminal',
          target: null, replyTo: null, msgType: 'agent_event'
        });
      }
      return json({ ok: true, event });
    }

    if (event === 'AfterAgent') {
      if (chatId) {
        const content = JSON.stringify({
          class: 'thinking',
          payload: { status: null }, // clear thinking status
          text: 'Gemini finished turn',
        });
        const id = nanoid();
        queries.createMessage(id, chatId, 'assistant', content, 'text', 'complete', sessionId, null, null, 'agent_event', '{}');
        await router.route({
          id, sessionId: chatId, content, role: 'assistant',
          senderId: sessionId, senderName: 'Gemini', senderType: 'terminal',
          target: null, replyTo: null, msgType: 'agent_event'
        });
      }
      return json({ ok: true, event });
    }

    if (event === 'SessionEnd') {
      if (chatId) {
        const text = `🏁 Gemini session ended`;
        const id = nanoid();
        queries.createMessage(id, chatId, 'assistant', text, 'text', 'complete', sessionId, null, null, 'message', '{}');
        await router.route({
          id, sessionId: chatId, content: text, role: 'assistant',
          senderId: sessionId, senderName: 'Gemini', senderType: 'terminal',
          target: null, replyTo: null, msgType: 'message'
        });
      }
      return json({ ok: true, event });
    }
  }

  // --- Claude Code Hooks ---
  if (event === 'Notification') {
    // Claude is waiting for input — post an agent_event to the chat
    const notifType = body.notification_type || 'unknown';
    if (!chatId) return json({ ok: true, skipped: 'no linked chat' });

    const content = JSON.stringify({
      class: notifType === 'permission_prompt' ? 'permission_request' : 'free_text',
      payload: {
        notification_type: notifType,
        message: body.message || `Claude is waiting (${notifType})`,
      },
      text: body.message || `Claude is waiting for input (${notifType})`,
    });

    const msgId = nanoid();
    queries.createMessage(
      msgId, chatId, 'assistant', content, 'text', 'complete',
      sessionId || null, null, null, 'agent_event', '{}'
    );

    // Route via MessageRouter
    await router.route({
      id: msgId, sessionId: chatId, content, role: 'assistant',
      senderId: sessionId || null, senderName: 'Claude', senderType: 'terminal',
      target: null, replyTo: null, msgType: 'agent_event'
    });

    if (sessionId) {
      try {
        const eventPayload = JSON.parse(content);
        const { trackEvent } = await import('$lib/server/agent-event-bus.js');
        trackEvent(sessionId, msgId, chatId, eventPayload);
        broadcastGlobal({
          type: 'session_needs_input',
          sessionId,
          eventClass: eventPayload.class,
          summary: body.message || `Claude is waiting (${notifType})`,
        });
      } catch {}
    }

    return json({ ok: true, msgId, event: 'notification', notifType });
  }

  if (event === 'TaskCreated' || event === 'TaskCompleted') {
    // Sync task to ANT's task system
    if (!sessionId) return json({ ok: true, skipped: 'no session' });

    const taskName = body.task_name || body.description || 'Unnamed task';
    const taskId = body.task_id || nanoid();
    const status = event === 'TaskCompleted' ? 'complete' : 'open';

    // Upsert task in ANT
    try {
      const existing: any = queries.getTask(taskId);
      if (existing) {
        queries.updateTask(taskId, status, null, null, null);
      } else {
        queries.createTask(taskId, sessionId, null, taskName, null);
      }
    } catch {}

    // Also post to linked chat as a status message
    if (chatId) {
      const emoji = status === 'complete' ? '✅' : '📋';
      const text = `${emoji} Task ${status === 'complete' ? 'completed' : 'created'}: ${taskName}`;
      const msgId = nanoid();
      queries.createMessage(
        msgId, chatId, 'assistant', text, 'text', 'complete',
        sessionId, null, null, 'message', '{}'
      );
      
      await router.route({
        id: msgId, sessionId: chatId, content: text, role: 'assistant',
        senderId: sessionId || null, senderName: 'Claude', senderType: 'terminal',
        target: null, replyTo: null, msgType: 'message'
      });
    }

    return json({ ok: true, event, taskId, status });
  }

  if (event === 'PostToolUse') {
    // Log tool usage — lightweight, just for the terminal text view
    // Don't spam the chat with every tool call
    return json({ ok: true, event: 'tool_logged' });
  }

  if (event === 'Stop') {
    // Claude finished responding — could update status in ANT
    if (chatId) {
      const reason = body.stop_reason || 'end_turn';
      const msgId = nanoid();
      const text = `⏹ Claude stopped (${reason})`;
      queries.createMessage(
        msgId, chatId, 'assistant', text, 'text', 'complete',
        sessionId, null, null, 'message', '{}'
      );
      
      await router.route({
        id: msgId, sessionId: chatId, content: text, role: 'assistant',
        senderId: sessionId || null, senderName: 'Claude', senderType: 'terminal',
        target: null, replyTo: null, msgType: 'message'
      });
    }
    return json({ ok: true, event: 'stop' });
  }

  // Unknown event — acknowledge but don't act
  return json({ ok: true, event, action: 'ignored' });
}
