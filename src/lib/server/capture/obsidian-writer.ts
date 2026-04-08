// ANT v3 — Obsidian Vault Writer
// Writes session summaries as markdown with YAML frontmatter
// Never throws — all errors are caught silently to protect the server

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
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
  if (!vaultExists()) {
    console.log(`[obsidian] Vault not found at ${VAULT_ROOT} — skipping`);
    return null;
  }

  // Fetch session row
  const session = queries.getSession(sessionId) as any;
  if (!session) {
    console.warn(`[obsidian] Session not found: ${sessionId}`);
    return null;
  }

  // Fetch command count
  const cmdRows = queries.getCommands(sessionId, 9999) as any[];
  const commandCount = cmdRows.length;

  // Fetch last 20 messages
  const allMessages = queries.listMessages(sessionId) as any[];
  const recentMessages = allMessages.slice(-20);

  // Determine date from created_at for directory structure
  const baseDate = session.created_at || new Date().toISOString();
  const { year, month } = isoYearMonth(baseDate);

  const sessionDir = join(ANT_VAULT, 'sessions', year, month);
  mkdirSync(sessionDir, { recursive: true });

  const fname = `${safeName(session.name)}_${shortId(sessionId)}.md`;
  const filepath = join(sessionDir, fname);

  // ── Build frontmatter ──────────────────────────────────────────────────────
  const frontmatter = [
    '---',
    `session_id: ${sessionId}`,
    `session_name: ${session.name}`,
    `type: ${session.type}`,
    `root_dir: ${session.root_dir ?? 'null'}`,
    `created_at: ${session.created_at ?? ''}`,
    `last_activity: ${session.last_activity ?? ''}`,
    `command_count: ${commandCount}`,
    `mempalace_wing: ant`,
    `tags: [ant, terminal, ${year}-${month}]`,
    '---',
  ].join('\n');

  // ── Recent messages block (last 5 for readability) ─────────────────────────
  const displayMessages = recentMessages.slice(-5);
  const messagesBlock = displayMessages.length === 0
    ? '_No messages yet_'
    : displayMessages.map((m: any) => {
        const snippet = String(m.content ?? '').replace(/\n/g, ' ').slice(0, 120);
        return `- **${m.role}**: ${snippet}`;
      }).join('\n');

  // ── Markdown body ──────────────────────────────────────────────────────────
  const body = `
# ${session.name}

**Session:** \`${sessionId}\`
**Type:** ${session.type}
**Started:** ${session.created_at ?? 'unknown'}
**Last active:** ${session.last_activity ?? 'unknown'}
**Commands captured:** ${commandCount}

## Recent Messages

${messagesBlock}

## Notes

_Add notes here_
`.trimStart();

  const content = `${frontmatter}\n\n${body}`;

  writeFileSync(filepath, content, 'utf-8');
  console.log(`[obsidian] Wrote session summary: ${filepath}`);
  return filepath;
}

// ── Safe wrapper — never throws ───────────────────────────────────────────────

export async function maybeWriteSessionSummary(sessionId: string): Promise<void> {
  try {
    if (!vaultExists()) return;
    writeSessionSummary(sessionId);
  } catch (err: any) {
    // Silently swallow — Obsidian write must never crash the server
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
    session.project        ? `project: "${session.project}"` : null,
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
