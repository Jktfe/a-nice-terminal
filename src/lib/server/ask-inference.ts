export type AskStatus = 'candidate' | 'open' | 'answered' | 'deferred' | 'dismissed';
export type AskOwnerKind = 'human' | 'agent' | 'room' | 'terminal' | 'unknown';
export type AskPriority = 'low' | 'normal' | 'high';

export interface AskDraft {
  title: string;
  body: string;
  recommendation: string | null;
  status: AskStatus;
  assignedTo: string;
  ownerKind: AskOwnerKind;
  priority: AskPriority;
  inferred: boolean;
  confidence: number;
  meta: Record<string, unknown>;
}

export interface AskInferenceInput {
  sessionId: string;
  messageId: string;
  content: string;
  senderId?: string | null;
  target?: string | null;
  msgType?: string | null;
  meta?: Record<string, unknown> | null;
}

const STRONG_PATTERNS = [
  /\b(?:do you want|want me to|shall i|should i|should we|can you decide|need(?:s)? a decision|please decide)\b/i,
  /\b(?:approve|approval|authori[sz]e|confirm|deny|reject|green light|go ahead)\b/i,
  /\b(?:pick|choose|which option|option [abc]|[abc]\))\b/i,
  /\b(?:blocked|blocker|waiting on|needs input|needs action|action needed)\b/i,
  /\b(?:open question|question for|recommendation|recommended|i recommend)\b/i,
];

const WEAK_PATTERNS = [
  /\?/,
  /\b(?:what am i being asked|next step|what should|how should|can someone|could someone)\b/i,
  /\b(?:todo|follow-up|follow up|worth doing|useful to action)\b/i,
];

const ACTIONABLE_PATTERNS = [
  /\b(?:do you want|want me to|shall i|shall we|should i|should we|can you|could you|would you|will you)\b/i,
  /\b(?:please (?:decide|approve|authori[sz]e|confirm|deny|reject|pick|choose))\b/i,
  /\b(?:approve|confirm|green light|go ahead)\?\b/i,
  /\b(?:which option|pick one|choose one)\b/i,
  /(?:^|\n)\s*(?:[a-c]|\d+)[\).]\s+.{4,160}\?/i,
  /\b(?:blocked on|is blocked|are blocked|waiting on (?:you|james|human|input|decision|approval)|needs (?:your )?(?:input|decision|approval|action)|action needed)\b/i,
  /\b(?:can you fill|can you drop|anything missing|anything you'd change|where are we|if you can)\b/i,
];

const STATUS_NOISE_PATTERNS = [
  /^\s*(?:status update|quick consolidation|verified|done|delivered|landed|shipped|live-verified|bridge live|acknowledged|agreed|excellent)\b/i,
  /^\s*.{0,80}\b(?:landed|delivered|shipped|verified|live-verified)\b[.!:]?/i,
  /\b(?:is delivered|done and tested|tests? pass|build clean|smoke verified|holding for|ready for review|presentable as-is)\b/i,
  /\b(?:i am taking|i'm taking|i am moving|starting with|posting again|will report back|next concrete deliverable)\b/i,
  /\b(?:critique on|research done|synthesis landed|plan \+ deck are presentable)\b/i,
];

const TERMINAL_PATTERNS = /\b(?:terminal|raw terminal|browser automation|click yes|type into|keyboard|prompt|stdin|pty)\b/i;
const AGENT_PATTERNS = /\b(?:agent|codex|claude|gemini|copilot|tesla|epicurus|worker|explorer)\b/i;
const HUMAN_PATTERNS = /\b(?:james|human|user|owner)\b/i;

const ROUTING_MARKERS = [
  ' -- reply with:',
  '\n-- reply with:',
  ' -- Routing:',
  '\n-- Routing:',
];

export function stripAntRoutingNoise(content: string): string {
  let text = content.replace(/\r\n/g, '\n').trim();
  for (const marker of ROUTING_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx >= 0) text = text.slice(0, idx).trim();
  }
  return text;
}

export function normalizeAskStatus(value: unknown, fallback: AskStatus = 'open'): AskStatus {
  const raw = String(value ?? '').toLowerCase();
  if (raw === 'candidate' || raw === 'open' || raw === 'answered' || raw === 'deferred' || raw === 'dismissed') return raw;
  if (raw === 'done' || raw === 'complete' || raw === 'resolved' || raw === 'responded') return 'answered';
  if (raw === 'reject' || raw === 'rejected' || raw === 'discarded') return 'dismissed';
  if (raw === 'snooze' || raw === 'later') return 'deferred';
  return fallback;
}

export function normalizeAskOwnerKind(value: unknown, fallback: AskOwnerKind = 'room'): AskOwnerKind {
  const raw = String(value ?? '').toLowerCase();
  if (raw === 'human' || raw === 'agent' || raw === 'room' || raw === 'terminal' || raw === 'unknown') return raw;
  return fallback;
}

export function normalizeAskPriority(value: unknown, fallback: AskPriority = 'normal'): AskPriority {
  const raw = String(value ?? '').toLowerCase();
  if (raw === 'low' || raw === 'normal' || raw === 'high') return raw;
  if (raw === 'urgent' || raw === 'blocked') return 'high';
  return fallback;
}

export function normalizeAskAction(value: unknown): string | null {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (['approve', 'approved', 'yes', 'y', 'accept', 'accepted', 'go', 'run'].includes(raw)) return 'approve';
  if (['reject', 'rejected', 'deny', 'denied', 'no', 'n', 'cancel'].includes(raw)) return 'reject';
  if (['defer', 'deferred', 'snooze', 'later', 'hold'].includes(raw)) return 'defer';
  if (['dismiss', 'dismissed', 'discard', 'discarded'].includes(raw)) return 'dismiss';
  if (['answer', 'answered', 'respond', 'responded', 'done', 'resolve', 'resolved'].includes(raw)) return 'answer';
  return raw.slice(0, 40);
}

export function titleFromAskContent(content: string, maxLength = 110): string {
  const clean = stripAntRoutingNoise(content)
    .replace(/\s+/g, ' ')
    .replace(/^\[[^\]]+\]\s*/, '')
    .trim();
  const sentenceMatch = clean.match(/^(.{12,}?[?!\.])\s/);
  const base = (sentenceMatch?.[1] || clean.split('\n')[0] || clean).trim();
  if (base.length <= maxLength) return base;
  return `${base.slice(0, maxLength - 1).trim()}…`;
}

function extractRecommendation(content: string): string | null {
  const lines = stripAntRoutingNoise(content).split('\n').map((line) => line.trim()).filter(Boolean);
  const hit = lines.find((line) => /\b(?:recommendation|recommended|i recommend|my recommendation)\b/i.test(line));
  if (!hit) return null;
  return hit.replace(/^(?:recommendation|recommended|my recommendation|i recommend)\s*[:\-]\s*/i, '').slice(0, 500);
}

export function isLikelyAskNoise(content: string): boolean {
  const clean = stripAntRoutingNoise(content).replace(/\s+/g, ' ').trim();
  if (!clean) return true;
  if (STATUS_NOISE_PATTERNS.some((pattern) => pattern.test(clean))) return true;
  if (ACTIONABLE_PATTERNS.some((pattern) => pattern.test(clean))) return false;
  if (/\b(?:recommendation|recommended|i recommend|my recommendation)\b/i.test(clean) && !clean.includes('?')) return true;
  return false;
}

export function isActionableAskContent(content: string, confidence = 0, inferred = true): boolean {
  const clean = stripAntRoutingNoise(content).replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  if (!inferred) return true;
  if (isLikelyAskNoise(clean)) return false;
  return ACTIONABLE_PATTERNS.some((pattern) => pattern.test(clean));
}

function mentionedHandles(content: string): string[] {
  const handles = new Set<string>();
  const matches = content.matchAll(/(^|\s)(@[a-zA-Z0-9._-]{2,})\b/g);
  for (const match of matches) {
    if (match[2] !== '@everyone') handles.add(match[2]);
  }
  return [...handles];
}

function inferOwner(content: string, target?: string | null): { assignedTo: string; ownerKind: AskOwnerKind } {
  if (target && target !== '@everyone') {
    return {
      assignedTo: target,
      ownerKind: HUMAN_PATTERNS.test(target) ? 'human' : 'agent',
    };
  }

  const handles = mentionedHandles(content);
  if (handles.length === 1) {
    return {
      assignedTo: handles[0],
      ownerKind: HUMAN_PATTERNS.test(handles[0]) ? 'human' : 'agent',
    };
  }

  if (TERMINAL_PATTERNS.test(content)) return { assignedTo: 'terminal', ownerKind: 'terminal' };
  if (HUMAN_PATTERNS.test(content)) return { assignedTo: 'human', ownerKind: 'human' };
  if (AGENT_PATTERNS.test(content)) return { assignedTo: 'agent', ownerKind: 'agent' };
  return { assignedTo: 'room', ownerKind: 'room' };
}

export function inferAskFromMessage(input: AskInferenceInput): AskDraft | null {
  const msgType = input.msgType || 'message';
  if (!['message', 'agent_event', 'prompt', 'title'].includes(msgType)) return null;
  const meta = input.meta as Record<string, any> | null | undefined;
  if (meta?.ask_id || meta?.ask?.id || meta?.source === 'ask_queue') return null;

  const content = stripAntRoutingNoise(input.content);
  if (content.length < 12) return null;

  let score = 0;
  for (const pattern of STRONG_PATTERNS) if (pattern.test(content)) score += 0.3;
  for (const pattern of WEAK_PATTERNS) if (pattern.test(content)) score += 0.12;
  if (input.target && input.target !== '@everyone') score += 0.15;
  if (TERMINAL_PATTERNS.test(content)) score += 0.08;
  if (/^\s*(?:\d+[\).]|[-*]\s+)/m.test(content) && /\?|\b(?:option|choose|pick)\b/i.test(content)) score += 0.12;
  if (/\b(?:fyi|status update|done|completed|landed|verified)\b/i.test(content) && !/\?/.test(content)) score -= 0.15;
  if (isLikelyAskNoise(content)) score -= 0.22;

  const confidence = Math.max(0, Math.min(0.98, Number(score.toFixed(2))));
  if (confidence < 0.28) return null;

  const owner = inferOwner(content, input.target);
  const priority = /\b(?:blocked|blocker|urgent|tonight|morning|asap|stuck|needs input)\b/i.test(content)
    ? 'high'
    : confidence < 0.42 ? 'low' : 'normal';

  return {
    title: titleFromAskContent(content),
    body: content,
    recommendation: extractRecommendation(content),
    status: 'candidate',
    assignedTo: owner.assignedTo,
    ownerKind: owner.ownerKind,
    priority,
    inferred: true,
    confidence,
    meta: {
      source: 'inferred_from_message',
      source_message_id: input.messageId,
      source_msg_type: msgType,
      source_sender_id: input.senderId ?? null,
    },
  };
}
