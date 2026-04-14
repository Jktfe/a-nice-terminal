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
import { nanoid } from 'nanoid';

export async function POST({ request }: RequestEvent) {
  let body: any;
  try { body = await request.json(); } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }

  const event = body.hook_event_name;
  const sessionId = body.ant_session_id;

  if (!event) return json({ error: 'hook_event_name required' }, { status: 400 });

  // Find the linked chat for this session (if any)
  let chatId: string | null = null;
  if (sessionId) {
    const session: any = queries.getSession(sessionId);
    chatId = session?.linked_chat_id ?? null;
  }

  // ─── Route by event type ──────────────────────────────────────────────

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
      sessionId || null, null, 'agent_event', '{}'
    );

    // Broadcast via WS
    const { broadcast } = await import('$lib/server/ws-broadcast.js');
    broadcast(chatId, {
      type: 'message_created',
      sessionId: chatId,
      id: msgId,
      session_id: chatId,
      role: 'assistant',
      content,
      format: 'text',
      status: 'complete',
      sender_id: sessionId,
      target: null,
      msg_type: 'agent_event',
    });

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
      const existing: any = queries.getTask?.(sessionId, taskId);
      if (existing) {
        queries.updateTask?.(sessionId, taskId, status);
      } else {
        queries.createTask?.(sessionId, taskId, taskName, status);
      }
    } catch {}

    // Also post to linked chat as a status message
    if (chatId) {
      const emoji = status === 'complete' ? '✅' : '📋';
      const text = `${emoji} Task ${status === 'complete' ? 'completed' : 'created'}: ${taskName}`;
      const msgId = nanoid();
      queries.createMessage(
        msgId, chatId, 'assistant', text, 'text', 'complete',
        sessionId, null, 'message', '{}'
      );
      const { broadcast } = await import('$lib/server/ws-broadcast.js');
      broadcast(chatId, {
        type: 'message_created', sessionId: chatId, id: msgId,
        session_id: chatId, role: 'assistant', content: text,
        format: 'text', status: 'complete', sender_id: sessionId,
        target: null, msg_type: 'message',
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
        sessionId, null, 'message', '{}'
      );
      const { broadcast } = await import('$lib/server/ws-broadcast.js');
      broadcast(chatId, {
        type: 'message_created', sessionId: chatId, id: msgId,
        session_id: chatId, role: 'assistant', content: text,
        format: 'text', status: 'complete', sender_id: sessionId,
        target: null, msg_type: 'message',
      });
    }
    return json({ ok: true, event: 'stop' });
  }

  // Unknown event — acknowledge but don't act
  return json({ ok: true, event, action: 'ignored' });
}
