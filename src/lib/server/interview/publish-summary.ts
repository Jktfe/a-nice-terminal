// Interview Mode — Publish Summary
//
// M2 #2: at any point in an interview, human or agent can hit "Publish
// summary". The agent emits a structured summary inside the linked chat;
// the server picks it up and posts it to the origin room with a back-link.
//
// This module owns the on-the-wire shape so the agent driver, the server
// router, and the receiving room render the same fields. The five buckets
// in the M2 acceptance test (findings, decisions, asks, actions, sources)
// are the required structure.

export const PUBLISH_SUMMARY_VERSION = 1 as const;

export interface SummaryAnchor {
  message_id: string;
  excerpt: string;
}

export interface PublishSummary {
  schema_version: typeof PUBLISH_SUMMARY_VERSION;
  title: string;
  findings: string[];
  decisions: string[];
  asks: string[];
  actions: string[];
  sources: SummaryAnchor[];
  linked_chat_id: string;
  origin_room_id: string;
  authored_by: string | null;
  generated_at_ms: number;
}

export interface PublishSummaryInput {
  title: string;
  findings?: string[];
  decisions?: string[];
  asks?: string[];
  actions?: string[];
  sources?: SummaryAnchor[];
  linkedChatId: string;
  originRoomId: string;
  authoredBy?: string | null;
  generatedAtMs?: number;
}

function dropEmpty(items: string[] | undefined): string[] {
  if (!items) return [];
  const out: string[] = [];
  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function cleanAnchors(items: SummaryAnchor[] | undefined): SummaryAnchor[] {
  if (!items) return [];
  const out: SummaryAnchor[] = [];
  for (const a of items) {
    if (!a || typeof a.message_id !== 'string' || a.message_id.length === 0) continue;
    if (typeof a.excerpt !== 'string') continue;
    out.push({ message_id: a.message_id, excerpt: a.excerpt.trim() });
  }
  return out;
}

export function buildPublishSummary(input: PublishSummaryInput): PublishSummary {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length === 0) throw new Error('title is required');
  if (typeof input.linkedChatId !== 'string' || input.linkedChatId.length === 0) {
    throw new Error('linkedChatId is required');
  }
  if (typeof input.originRoomId !== 'string' || input.originRoomId.length === 0) {
    throw new Error('originRoomId is required');
  }
  return {
    schema_version: PUBLISH_SUMMARY_VERSION,
    title,
    findings: dropEmpty(input.findings),
    decisions: dropEmpty(input.decisions),
    asks: dropEmpty(input.asks),
    actions: dropEmpty(input.actions),
    sources: cleanAnchors(input.sources),
    linked_chat_id: input.linkedChatId,
    origin_room_id: input.originRoomId,
    authored_by: input.authoredBy ?? null,
    generated_at_ms: input.generatedAtMs ?? Date.now(),
  };
}

export function serializePublishSummary(s: PublishSummary): string {
  return JSON.stringify(s);
}

export function parsePublishSummary(raw: unknown): PublishSummary | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.schema_version !== PUBLISH_SUMMARY_VERSION) return null;
  if (typeof o.title !== 'string' || o.title.length === 0) return null;
  if (typeof o.linked_chat_id !== 'string') return null;
  if (typeof o.origin_room_id !== 'string') return null;
  if (typeof o.generated_at_ms !== 'number') return null;
  const stringList = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null;
    if (!v.every((x) => typeof x === 'string')) return null;
    return v;
  };
  const findings = stringList(o.findings);
  const decisions = stringList(o.decisions);
  const asks = stringList(o.asks);
  const actions = stringList(o.actions);
  if (!findings || !decisions || !asks || !actions) return null;
  if (!Array.isArray(o.sources)) return null;
  const sources: SummaryAnchor[] = [];
  for (const s of o.sources) {
    if (!s || typeof s !== 'object') return null;
    const so = s as Record<string, unknown>;
    if (typeof so.message_id !== 'string' || typeof so.excerpt !== 'string') return null;
    sources.push({ message_id: so.message_id, excerpt: so.excerpt });
  }
  const authoredBy = o.authored_by;
  if (authoredBy !== null && typeof authoredBy !== 'string') return null;
  return {
    schema_version: PUBLISH_SUMMARY_VERSION,
    title: o.title,
    findings,
    decisions,
    asks,
    actions,
    sources,
    linked_chat_id: o.linked_chat_id,
    origin_room_id: o.origin_room_id,
    authored_by: authoredBy ?? null,
    generated_at_ms: o.generated_at_ms,
  };
}

// Format the summary as the markdown body posted to the origin room.
// Empty buckets are omitted so a sparse summary doesn't render six empty
// section headers. The transcript link is the back-link the M2 spec calls
// for; pass the deployment-correct base URL from the route handler.
export interface RenderOptions {
  transcriptUrl: string;
}

export function renderSummaryMarkdown(s: PublishSummary, opts: RenderOptions): string {
  const lines: string[] = [];
  lines.push(`## ${s.title}`);
  lines.push('');
  const sections: Array<[string, string[]]> = [
    ['Findings', s.findings],
    ['Decisions', s.decisions],
    ['Asks', s.asks],
    ['Actions', s.actions],
  ];
  for (const [heading, items] of sections) {
    if (items.length === 0) continue;
    lines.push(`### ${heading}`);
    for (const item of items) lines.push(`- ${item}`);
    lines.push('');
  }
  if (s.sources.length > 0) {
    lines.push('### Sources');
    for (const a of s.sources) {
      const trimmed = a.excerpt.length > 120 ? `${a.excerpt.slice(0, 117)}...` : a.excerpt;
      lines.push(`- ${a.message_id}: ${trimmed}`);
    }
    lines.push('');
  }
  lines.push(`Full transcript: ${opts.transcriptUrl}`);
  return lines.join('\n');
}
