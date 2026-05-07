// Claude Code menu extractor — tails the per-session JSONL transcript at
// `~/.claude/projects/<encoded_cwd>/<session_id>.jsonl` to surface the
// open `AskUserQuestion` / `ExitPlanMode` tool_use blocks as structured
// data ANT can render natively (see AgentMenuPrompt.svelte).
//
// Algorithm:
//   1. Read the tail of the jsonl (last maxBytes).
//   2. Collect every tool_result.tool_use_id we see in `user` entries —
//      these are the resolved tools.
//   3. Walk `assistant` entries backwards; the latest tool_use whose id
//      ISN'T in that resolved set is the open menu (if its name matches
//      one of our supported tools).
//   4. Extract the structured input the renderer needs.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentMenu } from '../lib/shared/agent-status.js';

// Re-export for convenience so callers don't need a separate import path.
export type { AgentMenu, AskUserQuestionMenu, ExitPlanModeMenu } from '../lib/shared/agent-status.js';

// Claude Code's encoding for the project dir: replace every '/' with '-'.
// Absolute paths therefore start with '-' (e.g. `-Users-jamesking-…`).
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function readTail(filePath: string, maxBytes: number): string {
  const text = readFileSync(filePath, 'utf8');
  if (text.length <= maxBytes) return text;
  return text.slice(text.length - maxBytes);
}

export function extractPendingMenu(
  sessionId: string,
  cwd: string,
  maxBytes = 256 * 1024,
): AgentMenu | null {
  const home = homedir();
  const projectDir = join(home, '.claude', 'projects', encodeProjectDir(cwd));
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
  if (!existsSync(jsonlPath)) return null;

  let tail: string;
  try {
    tail = readTail(jsonlPath, maxBytes);
  } catch {
    return null;
  }

  const lines = tail.split('\n').filter((l) => l.length > 0);

  // Collect resolved tool_use ids.
  const resolved = new Set<string>();
  for (const line of lines) {
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== 'user') continue;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        resolved.add(block.tool_use_id);
      }
    }
  }

  // Walk assistant entries from latest → earliest.
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: any;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry?.type !== 'assistant') continue;
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type !== 'tool_use') continue;
      const name = block?.name;
      const id = block?.id;
      if (typeof name !== 'string' || typeof id !== 'string') continue;
      if (resolved.has(id)) continue;

      if (name === 'AskUserQuestion') {
        const q = block?.input?.questions?.[0];
        if (!q) continue;
        return {
          kind: 'AskUserQuestion',
          question: typeof q.question === 'string' ? q.question : '',
          header: typeof q.header === 'string' ? q.header : '',
          options: Array.isArray(q.options)
            ? q.options.map((o: any) => ({
                label: String(o?.label ?? ''),
                description: String(o?.description ?? ''),
                preview: typeof o?.preview === 'string' ? o.preview : undefined,
              }))
            : [],
          multiSelect: !!q.multiSelect,
          toolUseId: id,
          sessionId,
        };
      }
      if (name === 'ExitPlanMode') {
        return {
          kind: 'ExitPlanMode',
          plan: String(block?.input?.plan ?? ''),
          toolUseId: id,
          sessionId,
        };
      }
    }
  }
  return null;
}
