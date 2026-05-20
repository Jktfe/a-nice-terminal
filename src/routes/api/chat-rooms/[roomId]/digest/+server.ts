import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { listMessagesInRoom } from '$lib/server/chatMessageStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { listFocusedMembersInRoom } from '$lib/server/focusModeStore';

const ACTIVE_WINDOW_MS = 5 * 60_000;
const IDLE_THRESHOLD_MS = 30 * 60_000;

type ActivityState = 'active' | 'recent' | 'idle' | 'focused';

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','was','are','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','shall','can',
  'not','no','nor','so','yet','both','either','neither','each','few','more',
  'most','other','some','such','than','then','there','these','they','this',
  'those','though','through','too','very','just','also','about','up','out',
  'if','when','how','what','which','who','that','i','you','he','she','it',
  'we','your','our','my','his','her','its','their','as','into','like','s',
  't','re','ll','ve','m','d','don','doesn','didn','won','can','ant'
]);

type KeyTerm = { term: string; count: number };

function extractKeyTerms(bodies: string[]): KeyTerm[] {
  const frequency: Record<string, number> = {};
  for (const body of bodies) {
    const words = body.toLowerCase().match(/\b[a-z][a-z]{2,}\b/g) ?? [];
    for (const word of words) {
      if (STOP_WORDS.has(word)) continue;
      frequency[word] = (frequency[word] ?? 0) + 1;
    }
  }
  return Object.entries(frequency)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));
}

export function GET({ params }: RequestEvent<{ roomId: string }>) {
  const roomId = params.roomId;
  if (!roomId) throw error(400, 'roomId required');

  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found');

  const messages = listMessagesInRoom(roomId);
  if (messages.length === 0) {
    return json({
      messageCount: 0,
      participantCount: 0,
      durationMinutes: 0,
      messagesPerHour: 0,
      participants: [],
      keyTerms: [],
      firstMessage: null,
      lastMessage: null
    });
  }

  const countsByHandle: Record<string, number> = {};
  const lastMessageMsByHandle: Record<string, number> = {};
  for (const message of messages) {
    countsByHandle[message.authorHandle] = (countsByHandle[message.authorHandle] ?? 0) + 1;
    const postedMs = new Date(message.postedAt).getTime();
    if (
      lastMessageMsByHandle[message.authorHandle] === undefined ||
      postedMs > lastMessageMsByHandle[message.authorHandle]
    ) {
      lastMessageMsByHandle[message.authorHandle] = postedMs;
    }
  }

  const focusedHandles = new Set(
    listFocusedMembersInRoom(roomId).map((entry) => entry.memberHandle)
  );
  const nowMs = Date.now();

  function classifyActivity(handle: string): ActivityState {
    if (focusedHandles.has(handle)) return 'focused';
    const lastMs = lastMessageMsByHandle[handle];
    if (lastMs === undefined) return 'idle';
    const ageMs = nowMs - lastMs;
    if (ageMs <= ACTIVE_WINDOW_MS) return 'active';
    if (ageMs <= IDLE_THRESHOLD_MS) return 'recent';
    return 'idle';
  }

  const participants = Object.entries(countsByHandle)
    .sort((left, right) => right[1] - left[1])
    .map(([id, count]) => ({
      id,
      count,
      lastMessageAtMs: lastMessageMsByHandle[id] ?? null,
      activityState: classifyActivity(id)
    }));

  const firstPostedAt = messages[0].postedAt;
  const lastPostedAt = messages[messages.length - 1].postedAt;
  const durationMs = new Date(lastPostedAt).getTime() - new Date(firstPostedAt).getTime();
  const durationMinutes = Math.max(0, Math.round(durationMs / 60_000));
  const durationHours = durationMs / 3_600_000;
  const messagesPerHour =
    durationHours > 0 ? Math.round(messages.length / durationHours) : messages.length;

  return json({
    messageCount: messages.length,
    participantCount: participants.length,
    durationMinutes,
    messagesPerHour,
    participants,
    keyTerms: extractKeyTerms(messages.map((message) => message.body)),
    firstMessage: firstPostedAt,
    lastMessage: lastPostedAt
  });
}
