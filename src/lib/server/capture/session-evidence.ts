import { queries } from '../db.js';

export interface EvidenceSession {
  id: string;
  name: string;
  type: string;
  root_dir: string | null;
  created_at: string | null;
  last_activity: string | null;
}

export interface EvidenceParticipant {
  id: string | null;
  name: string | null;
  handle: string | null;
  session_type: string | null;
  first_seen: string | null;
  last_seen: string | null;
  message_count: number;
}

export interface EvidenceTask {
  id: string;
  title: string;
  status: string;
  description: string | null;
  assigned_to?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface EvidenceFileRef {
  id: string;
  file_path: string;
  note: string | null;
  flagged_by: string | null;
  created_at?: string | null;
}

export interface EvidenceCommand {
  command: string;
  cwd: string | null;
  exit_code: number | null;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  output_snippet: string | null;
}

export interface EvidenceMessage {
  sender: string;
  created_at: string | null;
  content: string;
}

export interface EvidenceRunEvent {
  id: string;
  ts_ms: number;
  source: string;
  trust: string;
  kind: string;
  text: string;
  raw_ref: string | null;
}

export interface SessionEvidence {
  generated_at: string;
  session: EvidenceSession;
  counts: {
    messages: number;
    participants: number;
    tasks: number;
    file_refs: number;
    commands: number;
    run_events: number;
  };
  participants: EvidenceParticipant[];
  tasks: EvidenceTask[];
  file_refs: EvidenceFileRef[];
  commands: EvidenceCommand[];
  key_messages: EvidenceMessage[];
  run_events: EvidenceRunEvent[];
}

interface CollectOptions {
  messageLimit?: number;
  commandLimit?: number;
  runEventLimit?: number;
}

function normaliseContent(content: unknown): string {
  return String(content ?? '').trim().replace(/\s+/g, ' ');
}

function isJsonBlob(content: string): boolean {
  if (!content.startsWith('{') && !content.startsWith('[')) return false;
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

function isBoilerplateExchange(content: string): boolean {
  const lower = content.toLowerCase();
  if (content.length < 12) return true;
  if (/^(cd|pwd|ls|clear)(\s|$)/.test(lower)) return true;
  if (/^ant chat send\b/.test(lower)) return true;
  if (/^(test|testing|hello|hi|ok|okay|on it|done|thanks|cheers)[.! ]*$/.test(lower)) return true;
  if (/arrival:\s*@/.test(lower) && content.length < 120) return true;
  return false;
}

function meaningfulMessages(messages: any[], limit: number): EvidenceMessage[] {
  return messages
    .filter((m: any) => {
      if (m.msg_type === 'agent_event' || m.msg_type === 'agent_response' || m.msg_type === 'terminal_line') return false;
      const content = normaliseContent(m.content);
      if (!content || isJsonBlob(content) || isBoilerplateExchange(content)) return false;
      return true;
    })
    .slice(-limit)
    .map((m: any) => ({
      sender: m.sender_id?.startsWith('@') ? m.sender_id : (m.role === 'user' || m.role === 'human' ? 'James' : 'Agent'),
      created_at: m.created_at ?? null,
      content: normaliseContent(m.content).slice(0, 300),
    }));
}

export function safeEvidenceName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim().replace(/\s+/g, '-') || 'session';
}

export function collectSessionEvidence(sessionId: string, options: CollectOptions = {}): SessionEvidence | null {
  const session = queries.getSession(sessionId) as any;
  if (!session) return null;

  const messageLimit = options.messageLimit ?? 24;
  const commandLimit = options.commandLimit ?? 12;
  const runEventLimit = options.runEventLimit ?? 24;

  const allMessages = queries.listMessages(sessionId) as any[];
  const participants = queries.listParticipants(sessionId) as any[];
  const tasks = queries.listTasks(sessionId) as any[];
  const fileRefs = queries.listFileRefs(sessionId) as any[];
  const commands = queries.getCommands(sessionId, commandLimit) as any[];
  const runEvents = (queries.getRunEvents(sessionId, 0, null, null, null, runEventLimit) as any[]).reverse();

  return {
    generated_at: new Date().toISOString(),
    session: {
      id: session.id,
      name: session.name,
      type: session.type,
      root_dir: session.root_dir ?? null,
      created_at: session.created_at ?? null,
      last_activity: session.last_activity ?? null,
    },
    counts: {
      messages: allMessages.length,
      participants: participants.length,
      tasks: tasks.length,
      file_refs: fileRefs.length,
      commands: commands.length,
      run_events: runEvents.length,
    },
    participants: participants.map((p: any) => ({
      id: p.id ?? null,
      name: p.name ?? null,
      handle: p.handle ?? null,
      session_type: p.session_type ?? null,
      first_seen: p.first_seen ?? null,
      last_seen: p.last_seen ?? null,
      message_count: Number(p.message_count ?? 0),
    })),
    tasks: tasks.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      description: t.description ?? null,
      assigned_to: t.assigned_to ?? null,
      created_at: t.created_at ?? null,
      updated_at: t.updated_at ?? null,
    })),
    file_refs: fileRefs.map((f: any) => ({
      id: f.id,
      file_path: f.file_path,
      note: f.note ?? null,
      flagged_by: f.flagged_by ?? null,
      created_at: f.created_at ?? null,
    })),
    commands: commands.map((c: any) => ({
      command: c.command,
      cwd: c.cwd ?? null,
      exit_code: c.exit_code ?? null,
      started_at: c.started_at ?? null,
      ended_at: c.ended_at ?? null,
      duration_ms: c.duration_ms ?? null,
      output_snippet: c.output_snippet ?? null,
    })),
    key_messages: meaningfulMessages(allMessages, messageLimit),
    run_events: runEvents.map((e: any) => ({
      id: String(e.id),
      ts_ms: Number(e.ts_ms),
      source: e.source,
      trust: e.trust,
      kind: e.kind,
      text: normaliseContent(e.text).slice(0, 240),
      raw_ref: e.raw_ref ?? null,
    })),
  };
}

function mdEscape(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function bullet(items: string[], empty: string): string {
  if (items.length === 0) return empty;
  return items.map((item) => `- ${item}`).join('\n');
}

export function sessionEvidenceMarkdown(evidence: SessionEvidence): string {
  const s = evidence.session;
  const taskLines = evidence.tasks.map((t) => `[${t.status}] **${mdEscape(t.title)}**${t.description ? ` — ${mdEscape(t.description)}` : ''}`);
  const fileLines = evidence.file_refs.map((f) => `\`${mdEscape(f.file_path)}\`${f.note ? ` — ${mdEscape(f.note)}` : ''}`);
  const commandLines = evidence.commands.map((c) => `\`${mdEscape(c.command)}\`${c.exit_code === null ? '' : ` exit ${c.exit_code}`}${c.cwd ? ` — ${mdEscape(c.cwd)}` : ''}`);
  const messageLines = evidence.key_messages.map((m) => `**${mdEscape(m.sender)}**: ${mdEscape(m.content)}`);
  const runEventLines = evidence.run_events.map((e) => `\`${e.kind}\` ${e.source}:${e.trust}${e.raw_ref ? ` \`${mdEscape(e.raw_ref)}\`` : ''} — ${mdEscape(e.text)}`);

  return [
    `# ${s.name}`,
    '',
    `**Session:** \`${s.id}\`  `,
    `**Type:** ${s.type}  `,
    `**Root:** ${s.root_dir ? `\`${s.root_dir}\`` : '_none_'}  `,
    `**Generated:** ${evidence.generated_at}`,
    '',
    '## Counts',
    '',
    `Messages ${evidence.counts.messages} · Commands ${evidence.counts.commands} · Tasks ${evidence.counts.tasks} · File refs ${evidence.counts.file_refs} · Run events ${evidence.counts.run_events}`,
    '',
    '## Tasks',
    '',
    bullet(taskLines, '_No tasks captured_'),
    '',
    '## File References',
    '',
    bullet(fileLines, '_No file references captured_'),
    '',
    '## Commands',
    '',
    bullet(commandLines, '_No commands captured_'),
    '',
    '## Key Messages',
    '',
    bullet(messageLines, '_No key messages captured_'),
    '',
    '## Evidence Events',
    '',
    bullet(runEventLines, '_No run events captured_'),
  ].join('\n');
}
