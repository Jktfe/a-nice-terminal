// ANT v3 — Obsidian Vault Writer + Memory Palace ingest
// Writes session summaries as markdown with YAML frontmatter,
// AND writes a memory entry to the ANT memories table for in-app search.
// Never throws — all errors are caught silently to protect the server.

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { nanoid } from 'nanoid';
import { queries } from '../db.js';

// ── Vault location ────────────────────────────────────────────────────────────
const VAULT_ROOT = join(homedir(), 'Documents', 'Obsidian');
const ANT_VAULT  = join(VAULT_ROOT, 'ANT');

// ── Helpers ───────────────────────────────────────────────────────────────────

function vaultExists(): boolean {
  return existsSync(VAULT_ROOT);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoYearMonth(iso: string): { year: string; month: string } {
  const d = new Date(iso);
  return {
    year:  String(d.getFullYear()),
    month: pad2(d.getMonth() + 1),
  };
}

function safeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim() || 'session';
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// ── Core writer ───────────────────────────────────────────────────────────────

export function writeSessionSummary(sessionId: string): string | null {
  const session = queries.getSession(sessionId) as any;
  if (!session) {
    console.warn(`[obsidian] Session not found: ${sessionId}`);
    return null;
  }

  // Gather all data
  const allMessages    = queries.listMessages(sessionId) as any[];
  const participants   = queries.listParticipants(sessionId) as any[];
  const tasks          = queries.listTasks(sessionId) as any[];
  const fileRefs       = queries.listFileRefs(sessionId) as any[];
  const cmdRows        = queries.getCommands(sessionId, 9999) as any[];

  const baseDate = session.created_at || new Date().toISOString();
  const { year, month } = isoYearMonth(baseDate);

  // ── Build memory value (plain text — used for in-app search) ──────────────
  const participantList = participants.length
    ? participants.map((p: any) => `${p.handle ?? p.id} (${p.name}, ${p.message_count} msgs)`).join(', ')
    : 'none';

  const taskSummary = tasks.length
    ? tasks.map((t: any) => `[${t.status}] ${t.title}`).join('\n')
    : 'no tasks';

  const fileRefSummary = fileRefs.length
    ? fileRefs.map((f: any) => `${f.file_path}${f.note ? ` — ${f.note}` : ''}`).join('\n')
    : 'no file refs';

  const fullTranscript = allMessages
    .map((m: any) => {
      const sender = m.sender_id ?? (m.role === 'user' ? 'user' : 'assistant');
      return `[${sender}]: ${m.content}`;
    })
    .join('\n\n');

  const memoryValue = [
    `Session: ${session.name} (${session.type})`,
    `Period: ${session.created_at ?? ''} → ${session.last_activity ?? ''}`,
    `Participants: ${participantList}`,
    `Commands: ${cmdRows.length}`,
    '',
    '## Tasks',
    taskSummary,
    '',
    '## File refs',
    fileRefSummary,
    '',
    '## Full transcript',
    fullTranscript,
  ].join('\n');

  // ── Write to ANT memories table (in-app memory palace) ───────────────────
  try {
    const memId = nanoid();
    const tags  = JSON.stringify(['ant', 'session', session.type, `${year}-${month}`]);
    queries.upsertMemory(memId, `session:${safeName(session.name)}`, memoryValue, tags, sessionId, 'ant-export');
    console.log(`[mempalace] Saved session ${sessionId} to memories table`);
  } catch (e: any) {
    console.warn(`[mempalace] Failed to write memory for ${sessionId}: ${e?.message}`);
  }

  // ── Write to Obsidian vault (if present) ──────────────────────────────────
  if (!vaultExists()) {
    console.log(`[obsidian] Vault not found at ${VAULT_ROOT} — skipping file write`);
    return null;
  }

  const sessionDir = join(ANT_VAULT, 'sessions', year, month);
  mkdirSync(sessionDir, { recursive: true });

  const fname    = `${safeName(session.name)}_${shortId(sessionId)}.md`;
  const filepath = join(sessionDir, fname);

  // ── Frontmatter ────────────────────────────────────────────────────────────
  const frontmatter = [
    '---',
    `session_id: ${sessionId}`,
    `session_name: "${session.name}"`,
    `type: ${session.type}`,
    `root_dir: ${session.root_dir ?? 'null'}`,
    `created_at: ${session.created_at ?? ''}`,
    `last_activity: ${session.last_activity ?? ''}`,
    `message_count: ${allMessages.length}`,
    `command_count: ${cmdRows.length}`,
    `participant_count: ${participants.length}`,
    `mempalace_wing: ant`,
    `tags: [ant, session, ${session.type}, ${year}-${month}]`,
    '---',
  ].join('\n');

  // ── Participants section ───────────────────────────────────────────────────
  const participantsSection = participants.length === 0
    ? '_No participants_'
    : participants.map((p: any) =>
        `- **${p.handle ?? p.id}** — ${p.name}  (${p.message_count} messages, first seen ${p.first_seen?.slice(0, 16)})`
      ).join('\n');

  // ── Tasks section ─────────────────────────────────────────────────────────
  const tasksSection = tasks.length === 0
    ? '_No tasks_'
    : tasks.map((t: any) =>
        `- [${t.status === 'complete' ? 'x' : ' '}] **${t.title}** \`${t.status}\`${t.description ? `\n  ${t.description}` : ''}`
      ).join('\n');

  // ── File refs section ─────────────────────────────────────────────────────
  const fileRefsSection = fileRefs.length === 0
    ? '_No file refs_'
    : fileRefs.map((f: any) =>
        `- \`${f.file_path}\`${f.note ? ` — ${f.note}` : ''}`
      ).join('\n');

  // ── Full transcript (all messages) ────────────────────────────────────────
  const transcriptSection = allMessages.length === 0
    ? '_No messages_'
    : allMessages.map((m: any) => {
        const sender = m.sender_id ?? (m.role === 'user' ? 'user' : 'assistant');
        const ts     = m.created_at?.slice(11, 16) ?? '';
        const body   = String(m.content ?? '').slice(0, 800);
        return `**${sender}** \`${ts}\`\n${body}`;
      }).join('\n\n---\n\n');

  // ── Markdown body ──────────────────────────────────────────────────────────
  const body = `
# ${session.name}

**Session:** \`${sessionId}\`
**Type:** ${session.type}
**Started:** ${session.created_at ?? 'unknown'}
**Last active:** ${session.last_activity ?? 'unknown'}
**Messages:** ${allMessages.length}
**Commands captured:** ${cmdRows.length}

## Participants

${participantsSection}

## Tasks

${tasksSection}

## File References

${fileRefsSection}

## Full Transcript

${transcriptSection}

## Notes

_Add notes here_
`.trimStart();

  writeFileSync(filepath, `${frontmatter}\n\n${body}`, 'utf-8');
  console.log(`[obsidian] Wrote session summary: ${filepath}`);
  return filepath;
}

// ── Safe wrapper — never throws ───────────────────────────────────────────────

export async function maybeWriteSessionSummary(sessionId: string): Promise<void> {
  try {
    writeSessionSummary(sessionId);
  } catch (err: any) {
    console.warn(`[obsidian] Failed to write summary for ${sessionId}: ${err?.message ?? err}`);
  }
}

// ── Legacy export kept for any existing callers ───────────────────────────────

interface SessionSummaryLegacy {
  sessionId: string;
  name: string;
  type: string;
  project?: string;
  durationMinutes?: number;
  tokensUsed?: number;
  summary: string;
  tags?: string[];
}

export function writeSessionToVault(session: SessionSummaryLegacy): string | null {
  if (!vaultExists()) {
    console.log(`[obsidian] Vault not found at ${VAULT_ROOT}`);
    return null;
  }

  const now = new Date();
  const year  = String(now.getFullYear());
  const month = pad2(now.getMonth() + 1);
  const dir   = join(ANT_VAULT, 'sessions', year, month);

  mkdirSync(dir, { recursive: true });

  const fname    = `${safeName(session.name)}.md`;
  const filepath = join(dir, fname);

  const frontmatter = [
    '---',
    `session_id: "${session.sessionId}"`,
    `name: "${session.name}"`,
    `type: "${session.type}"`,
    session.project         ? `project: "${session.project}"` : null,
    session.durationMinutes ? `duration_minutes: ${session.durationMinutes}` : null,
    session.tokensUsed      ? `tokens_used: ${session.tokensUsed}` : null,
    `date: "${now.toISOString()}"`,
    session.tags?.length    ? `tags:\n${session.tags.map(t => `  - ${t}`).join('\n')}` : null,
    '---',
  ].filter(Boolean).join('\n');

  const content = `${frontmatter}\n\n${session.summary}\n`;
  writeFileSync(filepath, content, 'utf-8');
  console.log(`[obsidian] Wrote session summary: ${filepath}`);
  return filepath;
}
