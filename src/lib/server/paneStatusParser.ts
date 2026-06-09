/**
 * paneStatusParser — token-free agent state from a captured terminal pane.
 *
 * No LLM, no hook required: `tmux capture-pane` text in → canonical state out.
 * Two modes, matching JWPK's "sections" model (validated live 2026-06-09 across
 * all 6 CLIs in the Agents Agents room):
 *
 *   • LABEL CLIs (claude / codex / qwen) print their state IN the status strip
 *     — we READ it (exact, single sample).
 *   • LABEL-LESS CLIs (agy / copilot / pi) print no word — we use STREAMING-DIFF:
 *     hash the pane tail, and if it changed since the last poll the agent is
 *     producing output (working), else idle. (A *stale* activity bullet is NOT
 *     activity — that false-positive is exactly why presence-of-text can't be
 *     trusted and change-over-time must be.)
 *
 * Pure + deterministic (the caller supplies the capture text + the prior hash),
 * so it's fully unit-tested against real captured fixtures. Wiring: a poller
 * captures each pane, calls parsePaneState(kind, text, prevHash), stores the
 * returned hash for next time, and feeds `state` into the agent-status pipeline
 * (a higher-confidence signal than fingerprintHasher's whole-pane hash, and it
 * removes the perspective Stop-classify for the label CLIs).
 */

export type CliKind = 'claude' | 'codex' | 'qwen' | 'agy' | 'copilot' | 'pi';

/** Canonical agent state the ants/footer consume. */
export type PaneState =
  | 'working'
  | 'thinking'
  | 'idle'
  | 'response-required'
  | 'complete'
  | 'permission'
  | 'unknown';

export type ParseSource = 'label' | 'stream' | 'first-sample';

export interface PaneParse {
  state: PaneState;
  source: ParseSource;
  /** The pane line/token the verdict came from (for display + debugging). */
  evidence: string;
  /** Hash of the pane tail — the caller stores this and passes it back next poll. */
  tailHash: string;
}

const LABEL_KINDS: ReadonlySet<CliKind> = new Set<CliKind>(['claude', 'codex', 'qwen']);
export function isLabelCli(kind: CliKind): boolean {
  return LABEL_KINDS.has(kind);
}

/** Last N non-blank, right-trimmed lines — the status region. */
function tail(captureText: string, n = 12): string[] {
  return captureText
    .split('\n')
    .map((l) => l.replace(/\s+$/u, ''))
    .filter((l) => l.trim().length > 0)
    .slice(-n);
}

/** Stable 32-bit hash of the pane tail; used for streaming-diff across polls. */
export function tailHash(captureText: string, n = 12): string {
  const t = tail(captureText, n).join('\n');
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const CLAUDE_LABELS: Record<string, PaneState> = {
  working: 'working',
  waiting: 'idle',
  'response needed': 'response-required',
  available: 'idle',
  menu: 'working',
  permission: 'permission'
};

function parseLabel(kind: CliKind, lines: string[]): { state: PaneState; evidence: string } | null {
  const joined = lines.join('\n');

  if (kind === 'claude') {
    // status strip: `… │ <ctx>% │ <STATE> │ Remote Control` (│ or 2+ spaces as sep)
    const m = joined.match(/\|\s*(Working|Waiting|Response needed|Available|Menu|Permission)\s*(?:\||\s{2,}|$)/i);
    if (m) return { state: CLAUDE_LABELS[m[1].toLowerCase()] ?? 'unknown', evidence: m[1] };
    // strip activity (no label captured this frame): `✻ <verb> for <time>` = thinking
    const a = joined.match(/✻\s*\w+ for \d[^\n]*/);
    if (a) return { state: 'thinking', evidence: a[0] };
    return null;
  }

  if (kind === 'codex') {
    if (/•\s*Working \(/.test(joined)) return { state: 'working', evidence: joined.match(/•\s*Working \([^)]*\)/)![0] };
    if (/•\s*Running \w+ hook/.test(joined)) return { state: 'working', evidence: joined.match(/•\s*Running \w+ hook/)![0] };
    const m = joined.match(/·\s*(Working|Ready)\s*$/im);
    if (m) return { state: m[1].toLowerCase() === 'ready' ? 'idle' : 'working', evidence: `status: ${m[1]}` };
    return null;
  }

  if (kind === 'qwen') {
    // `<STATE>   NN% context used`
    const m = joined.match(/^\s*(Working|Complete|Waiting|Idle)\s+\d+(?:\.\d+)?% context used/im);
    if (m) {
      const w = m[1].toLowerCase();
      const state: PaneState = w === 'working' ? 'working' : w === 'complete' ? 'complete' : 'idle';
      return { state, evidence: m[0].trim() };
    }
    return null;
  }
  return null;
}

/**
 * Parse a captured pane into a canonical state.
 *
 * @param kind     which CLI (selects label-read vs streaming-diff)
 * @param captureText  `tmux capture-pane -p` output
 * @param prevHash the tailHash from the previous poll (label-less CLIs only);
 *                 omit/null on the first sample.
 */
export function parsePaneState(
  kind: CliKind,
  captureText: string,
  prevHash?: string | null
): PaneParse {
  const lines = tail(captureText);
  const hash = tailHash(captureText);

  if (isLabelCli(kind)) {
    const read = parseLabel(kind, lines);
    if (read) return { state: read.state, source: 'label', evidence: read.evidence, tailHash: hash };
    // label CLI but nothing matched this frame → fall back to streaming-diff
  }

  // label-less (or label-miss): streaming-diff. Needs a prior sample.
  if (prevHash === undefined || prevHash === null) {
    return { state: 'unknown', source: 'first-sample', evidence: lines.at(-1) ?? '', tailHash: hash };
  }
  const streaming = hash !== prevHash;
  return {
    state: streaming ? 'working' : 'idle',
    source: 'stream',
    evidence: lines.at(-1) ?? '',
    tailHash: hash
  };
}
