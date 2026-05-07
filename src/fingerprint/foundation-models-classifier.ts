// Foundation Models classifier — wraps the local `perspective --fm` CLI
// to classify an assistant message tail as "ResponseNeeded" or "Waiting".
//
// Mirrors `~/.claude/hooks/ant-status/classify.sh` (canonical reference).
// Used by drivers for CLIs that don't expose hooks (codex / gemini / qwen
// / pi / copilot) — fallback when the per-CLI hook plugin isn't installed
// on the current host.
//
// Properties:
//   - Deterministic (--temperature 0.0).
//   - Markdown-sanitised input (bold/code/links/bullets/tables stripped).
//   - 12 few-shot pairs + explicit "any question anywhere" rule.
//   - 2000-char tail cap.
//   - Falls back to 'Waiting' on any error and emits at most one warn per
//     process lifecycle so logs don't fill up with the same message.

import { spawn } from 'node:child_process';

export type ClassifierVerdict = 'ResponseNeeded' | 'Waiting';

const SYSTEM_PROMPT = `You are a binary classifier. Read the assistant message and reply with exactly one word: either "ResponseNeeded" or "Waiting". No other text. No punctuation. No explanation.

Rule: if the message contains ANY question to the user (anywhere — start, middle, or end), reply "ResponseNeeded". Trailing pleasantries, summaries, or compliments do not cancel an earlier question. If there is NO question and NO request for the user to decide or pick something, reply "Waiting".

Examples:
Input: "I have two options. Which would you prefer, A or B?"
Output: ResponseNeeded

Input: "The build completed successfully in 3.2 seconds."
Output: Waiting

Input: "Should we proceed with the migration?"
Output: ResponseNeeded

Input: "I have updated the script and verified the output. Both folders are now showing correctly."
Output: Waiting

Input: "Let me know which approach you prefer."
Output: ResponseNeeded

Input: "Done. The fix is in place."
Output: Waiting

Input: "Want me to wire this up next?"
Output: ResponseNeeded

Input: "Do you like rugby? Do you like beer? Your hair looks nice today."
Output: ResponseNeeded

Input: "All five tests passed and the deployment is live."
Output: Waiting

Input: "The server is running on port 8080. Let me know if you want me to change it."
Output: ResponseNeeded

Input: "I noticed three issues. Should I fix them now or document them first?"
Output: ResponseNeeded

Input: "Cleaned up the orphaned files. The cache is now 40% smaller."
Output: Waiting

Input: "Why this approach is cleaner — the new path avoids the race condition. What it preserves — the existing fallback. How it extends — by adding a matcher."
Output: Waiting

Input: "Why this matters: the lifecycle is now correct. Why we need it: dashboards depend on the state. Why it's safe: smoke tests pass."
Output: Waiting

Input: "What changed: the trigger. What stayed: the fallback. The combined behaviour is more reliable."
Output: Waiting`;

// Sanitise markdown so tokens like ** or backticks don't derail the small
// Foundation Model. Same rules as classify.sh.
export function sanitiseForClassifier(text: string): string {
  return (
    text
      // Strip table-like rows (whole-line `|` separators)
      .split('\n')
      .filter((line) => !/^[\s]*\|/.test(line))
      .filter((line) => !/^[\s]*[|+\-][\-=+| ]+[|+\-]?[\s]*$/.test(line))
      .join('\n')
      // Strip bold and italic
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      // Strip inline code
      .replace(/`([^`]+)`/g, '$1')
      // Strip markdown links
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Strip leading bullet markers (per-line)
      .replace(/^[\s]*[-*•][\s]+/gm, '')
      // Strip leading numbered list markers (per-line)
      .replace(/^[\s]*\d+\.[\s]+/gm, '')
      // Normalise unicode arrows / em-dashes
      .replace(/→/g, 'to')
      .replace(/[–—]/g, '-')
      // Collapse repeated spaces
      .replace(/[ ]+/g, ' ')
  );
}

// Trim to last N characters — small models lose focus on long inputs and the
// question is almost always in the tail.
function tailCap(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

let warnedMissing = false;

// Run perspective with stdin-based prompt to avoid shell quoting issues.
// Uses spawn (not exec) so user content can never be interpreted as shell.
async function runPerspective(systemPrompt: string, userPrompt: string, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(
        'perspective',
        ['--fm', '--temperature', '0.0', '--system', systemPrompt, '--prompt', userPrompt],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch {
      resolve(null);
      return;
    }

    let stdout = '';
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
        resolve(null);
      }
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        if (!warnedMissing) {
          warnedMissing = true;
          console.warn('[ant-status] perspective binary not available; classifier falling back to Waiting');
        }
        resolve(null);
      }
    });
    proc.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(stdout);
      }
    });
  });
}

export async function classifyTurnEnd(
  lastAssistantText: string
): Promise<ClassifierVerdict> {
  if (!lastAssistantText || lastAssistantText.trim().length === 0) {
    return 'Waiting';
  }
  const sanitised = sanitiseForClassifier(lastAssistantText);
  const trimmed = tailCap(sanitised, 2000);
  const userPrompt = `Input: "${trimmed}"\nOutput:`;

  const stdout = await runPerspective(SYSTEM_PROMPT, userPrompt);
  if (stdout == null) return 'Waiting';

  const firstLine = stdout.split('\n')[0]?.trim() ?? '';
  const cleaned = firstLine.replace(/[\s"']/g, '');

  if (cleaned.startsWith('ResponseNeeded')) return 'ResponseNeeded';
  if (cleaned.startsWith('Waiting')) return 'Waiting';
  return 'Waiting';
}

// Hash-based debounce — drivers call this once per assistant turn-end.
// We cache the (text-hash → verdict) so re-rendering doesn't re-spawn
// perspective. Drivers should pass the same text on every call until the
// agent posts a new turn.
const verdictCache = new Map<string, ClassifierVerdict>();

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export async function classifyTurnEndCached(
  lastAssistantText: string
): Promise<ClassifierVerdict> {
  const key = fnv1a(lastAssistantText);
  const cached = verdictCache.get(key);
  if (cached) return cached;
  const verdict = await classifyTurnEnd(lastAssistantText);
  verdictCache.set(key, verdict);
  // Cap cache size — keep the last ~200 unique turns.
  if (verdictCache.size > 200) {
    const firstKey = verdictCache.keys().next().value;
    if (firstKey) verdictCache.delete(firstKey);
  }
  return verdict;
}

// Test/diagnostic helper.
export function _clearClassifierCache(): void {
  verdictCache.clear();
  warnedMissing = false;
}
