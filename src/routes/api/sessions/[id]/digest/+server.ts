import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','was','are','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','shall','can',
  'not','no','nor','so','yet','both','either','neither','each','few','more',
  'most','other','some','such','than','then','there','these','they','this',
  'those','though','through','too','very','just','also','about','up','out',
  'if','when','how','what','which','who','that','i','you','he','she','it',
  'we','your','our','my','his','her','its','their','as','into','like','s',
  't','re','ll','ve','m','d','don','doesn','didn','won','can','ant',
]);

function extractKeyTerms(messages: any[]): { term: string; count: number }[] {
  const freq: Record<string, number> = {};
  for (const msg of messages) {
    const words = (msg.content || '').toLowerCase().match(/\b[a-z][a-z]{2,}\b/g) || [];
    for (const w of words) {
      if (!STOP_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));
}

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');

  const messages = queries.listMessages(params.id) as any[];
  if (messages.length === 0) {
    return json({
      messageCount: 0, participantCount: 0, durationMinutes: 0,
      messagesPerHour: 0, participants: [], keyTerms: [],
      firstMessage: null, lastMessage: null,
    });
  }

  // Participants
  const participantMap: Record<string, number> = {};
  for (const m of messages) {
    const p = m.sender_id || m.role || 'unknown';
    participantMap[p] = (participantMap[p] || 0) + 1;
  }
  const participants = Object.entries(participantMap)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, count }));

  // Time span
  const first = messages[0].created_at as string;
  const last = messages[messages.length - 1].created_at as string;
  const durationMs = new Date(last).getTime() - new Date(first).getTime();
  const durationMinutes = Math.round(durationMs / 60000);
  const durationHours = durationMs / 3600000;
  const messagesPerHour = durationHours > 0 ? Math.round(messages.length / durationHours) : messages.length;

  return json({
    messageCount: messages.length,
    participantCount: participants.length,
    durationMinutes,
    messagesPerHour,
    participants,
    keyTerms: extractKeyTerms(messages),
    firstMessage: first,
    lastMessage: last,
  });
}
