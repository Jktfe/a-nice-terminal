// ANT v3 — Claude Code Session Watcher
// Watches ~/.claude/projects/ for JSONL session files and ingests structured data

import { watch, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { queries } from '../db';
import { nanoid } from 'nanoid';

const CLAUDE_BASE = join(process.env.HOME || '', '.claude', 'projects');
const watchedFiles = new Map<string, number>(); // path -> last byte offset

export function startClaudeWatcher(): void {
  if (!existsSync(CLAUDE_BASE)) {
    console.log('[capture] ~/.claude/projects/ not found — Claude watcher disabled');
    return;
  }

  console.log(`[capture] Watching ${CLAUDE_BASE} for Claude Code sessions`);

  watch(CLAUDE_BASE, { recursive: true }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.jsonl')) return;

    const fullPath = join(CLAUDE_BASE, filename);
    processJSONLFile(fullPath);
  });
}

function processJSONLFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8');
    const lastOffset = watchedFiles.get(path) || 0;
    const newContent = content.slice(lastOffset);
    watchedFiles.set(path, content.length);

    if (!newContent.trim()) return;

    const lines = newContent.trim().split('\n');
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        ingestClaudeEntry(entry, path);
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    // File might be locked or deleted
  }
}

function ingestClaudeEntry(entry: any, sourcePath: string): void {
  // Claude Code JSONL format has various message types
  // Extract what we can and store as messages
  if (entry.type === 'human' || entry.type === 'assistant') {
    const role = entry.type === 'human' ? 'user' : 'assistant';
    const content = typeof entry.message === 'string'
      ? entry.message
      : entry.message?.content || JSON.stringify(entry.message);

    // Try to find or create a session for this source
    const sessionName = basename(sourcePath, '.jsonl').replace(/-/g, ' ');
    // Store with source metadata
    const meta = JSON.stringify({
      source: 'claude-code',
      file: sourcePath,
      tokens: entry.usage?.input_tokens,
      model: entry.model,
    });

    // For now, just log — full session linkage will be added later
    console.log(`[capture] Claude ${role}: ${content.slice(0, 80)}...`);
  }
}
