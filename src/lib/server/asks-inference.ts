/** Imperative starters that strongly imply an ask, even without trailing `?`. */
const ASK_STARTERS = [
  'shall i',
  'shall we',
  'should i',
  'should we',
  'want me to',
  'do you want',
  'can you',
  'could you',
  'would you',
  'will you',
  'is it',
  'are you',
];

const MAX_LINE_LENGTH = 280;
const MAX_ASKS = 8;

/** Normalise whitespace inside a candidate ask: trim and collapse runs. */
function normalise(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/** Case-insensitive trim equality used for dedup. */
function sameAsk(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** True if the trimmed line begins with one of the imperative ask starters. */
function startsWithAskStarter(line: string): boolean {
  const lower = line.trim().toLowerCase();
  return ASK_STARTERS.some((p) => lower === p || lower.startsWith(p + ' ') || lower.startsWith(p + ',') || lower.startsWith(p + ':'));
}

/**
 * Infer asks from free-form message content. Lines inside fenced code blocks
 * are skipped, as are lines exceeding {@link MAX_LINE_LENGTH}. Results are
 * deduplicated against `explicit` (case-insensitive trim) and against earlier
 * matches, preserving order of appearance, and capped at {@link MAX_ASKS}.
 */
export function inferAsks(content: string, explicit: string[] = []): string[] {
  if (typeof content !== 'string' || !content) return [];

  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!trimmed) continue;
    if (trimmed.length > MAX_LINE_LENGTH) continue;

    const isQuestion = trimmed.endsWith('?');
    if (!isQuestion && !startsWithAskStarter(trimmed)) continue;

    const ask = normalise(trimmed);
    if (!ask) continue;
    if (explicit.some((e) => sameAsk(e, ask))) continue;
    if (out.some((p) => sameAsk(p, ask))) continue;

    out.push(ask);
    if (out.length >= MAX_ASKS) break;
  }

  return out;
}
