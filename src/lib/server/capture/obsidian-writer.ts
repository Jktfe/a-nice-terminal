// ANT v3 — Obsidian Vault Writer
// Writes session summaries as markdown with YAML frontmatter

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const VAULT_PATH = process.env.ANT_OBSIDIAN_VAULT || '';

const SESSIONS_DIR = join(VAULT_PATH, 'coding-sessions');

interface SessionSummary {
  sessionId: string;
  name: string;
  type: string;
  project?: string;
  durationMinutes?: number;
  tokensUsed?: number;
  summary: string;
  tags?: string[];
}

export function writeSessionToVault(session: SessionSummary): string | null {
  if (!existsSync(VAULT_PATH)) {
    console.log(`[obsidian] Vault not found at ${VAULT_PATH}`);
    return null;
  }

  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const dir = join(SESSIONS_DIR, year, month);

  mkdirSync(dir, { recursive: true });

  const safeName = session.name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim();
  const filename = `${safeName}.md`;
  const filepath = join(dir, filename);

  const frontmatter = [
    '---',
    `session_id: "${session.sessionId}"`,
    `name: "${session.name}"`,
    `type: "${session.type}"`,
    session.project ? `project: "${session.project}"` : null,
    session.durationMinutes ? `duration_minutes: ${session.durationMinutes}` : null,
    session.tokensUsed ? `tokens_used: ${session.tokensUsed}` : null,
    `date: "${now.toISOString()}"`,
    session.tags?.length ? `tags:\n${session.tags.map(t => `  - ${t}`).join('\n')}` : null,
    '---',
  ].filter(Boolean).join('\n');

  const content = `${frontmatter}\n\n${session.summary}\n`;

  writeFileSync(filepath, content, 'utf-8');
  console.log(`[obsidian] Wrote session summary: ${filepath}`);
  return filepath;
}
