import type { ContextState } from './roomSessionContextStore';
import { resolveCurrentOwner } from './roomIdentityResolver';
import { findActiveRoomHandleForSession } from './roomHandleLeaseStore';
import { getSession } from './antSessionStore';
import { resolveMember as resolveCleanMember } from './membershipStore';

export type DeliveryAckAction = 'read' | 'work' | 'reply' | 'look' | 'pass';

export type DeliveryContextRef = {
  kind: 'plan' | 'task' | 'ask' | 'artefact' | 'file';
  id: string;
  label: string;
};

export type DeliveryActor = {
  sessionId: string;
  handle: string;
  displayName?: string;
  kind?: string;
  parentSessionId?: string | null;
  parentHandle?: string | null;
};

export type MessageDeliveryEnvelope = {
  roomId: string;
  roomName: string;
  messageId: string;
  postOrder: number;
  bodyMarkdown: string;
  sender: DeliveryActor & { displayName: string };
  recipient: DeliveryActor;
  contextRefs: DeliveryContextRef[];
  context: ContextState;
  replyTo: string | null;
  ackActions: DeliveryAckAction[];
  deliveredAtMs: number;
};

const DEFAULT_ACK_ACTIONS: DeliveryAckAction[] = ['read', 'work', 'reply', 'look', 'pass'];

function actorFor(roomId: string, handle: string, fallbackSessionId?: string): DeliveryActor {
  const cleanSessionId = resolveCleanMember(roomId, handle);
  const cleanSession = cleanSessionId ? getSession(cleanSessionId) : null;
  if (cleanSession) {
    const actor: DeliveryActor = {
      sessionId: cleanSession.id,
      handle,
      kind: cleanSession.kind
    };
    if (cleanSession.parent_session_id !== null) {
      actor.parentSessionId = cleanSession.parent_session_id;
      actor.parentHandle = findActiveRoomHandleForSession(roomId, cleanSession.parent_session_id)?.handle ?? null;
    }
    return actor;
  }
  const resolved = resolveCurrentOwner(roomId, handle);
  if (!resolved) {
    return { sessionId: fallbackSessionId ?? '', handle };
  }
  const actor: DeliveryActor = {
    sessionId: resolved.session.id,
    handle: resolved.lease.handle,
    kind: resolved.session.kind
  };
  if (resolved.session.parent_session_id !== null) {
    actor.parentSessionId = resolved.session.parent_session_id;
    actor.parentHandle = findActiveRoomHandleForSession(roomId, resolved.session.parent_session_id)?.handle ?? null;
  }
  return actor;
}

function displayNameFor(actor: DeliveryActor): string {
  if (actor.kind === 'subagent' && actor.parentHandle) {
    return `${actor.handle} via ${actor.parentHandle}`;
  }
  return actor.handle;
}

export function buildMessageDeliveryEnvelope(input: {
  roomId: string;
  roomName: string;
  message: {
    id: string;
    authorHandle: string;
    body: string;
    postOrder: number;
    parentMessageId?: string;
  };
  recipientHandle: string;
  recipientFallbackSessionId?: string;
  context: ContextState;
  deliveredAtMs?: number;
}): MessageDeliveryEnvelope {
  const sender = actorFor(input.roomId, input.message.authorHandle);
  const recipient = actorFor(input.roomId, input.recipientHandle, input.recipientFallbackSessionId);
  return {
    roomId: input.roomId,
    roomName: input.roomName,
    messageId: input.message.id,
    postOrder: input.message.postOrder,
    bodyMarkdown: input.message.body,
    sender: { ...sender, displayName: displayNameFor(sender) },
    recipient,
    contextRefs: [],
    context: input.context,
    replyTo: input.message.parentMessageId ?? null,
    ackActions: DEFAULT_ACK_ACTIONS,
    deliveredAtMs: input.deliveredAtMs ?? Date.now()
  };
}
