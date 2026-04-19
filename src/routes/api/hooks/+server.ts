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
