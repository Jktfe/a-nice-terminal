// fingerprintDetector — agent KIND identity (M3.2a). 5-source cascade
// per Q1; NEVER overwrites remote/browser (Q2); write-back opt-in (Q5).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getIdentityDb } from './db';
import { defaultTmuxCaptureFn, type CaptureFn } from './tmuxCapture';
import { type TerminalRow } from './terminalsStore';
import { type AgentKind } from './agentKindEnum';

export { type AgentKind };
export type Confidence = 'high' | 'medium' | 'low';
export type SourceLabel = 'process-tree' | 'tmux-title' | 'capture-fn' | 'name' | 'default';

export type Driver = { binary: string; version: string } | null;
export type Evidence = { source: SourceLabel; detail: string };
export type FingerprintDetectionResult = { terminal_id: string; kind: AgentKind; driver: Driver; confidence: Confidence; fallback: string; evidence: Evidence };
export type ProcessTreeFn = (pid: number) => { binary: string; comm: string }[];
export type DriverVersionFn = (binary: string) => string;
export type DetectorDeps = { processTreeFn?: ProcessTreeFn; tmuxTitleFn?: (terminal: TerminalRow) => string | null; captureFn?: CaptureFn; driverVersionFn?: DriverVersionFn };

const KIND_PATTERNS: Array<{ kind: AgentKind; rx: RegExp }> = [
  { kind: 'claude_code', rx: /\bclaude(?:[-_ ]code)?\b/i },
  { kind: 'codex_cli', rx: /\bcodex\b/i },
  { kind: 'cursor', rx: /\bcursor\b/i },
  { kind: 'gemini', rx: /\bgemini\b/i },
  { kind: 'aider', rx: /\baider\b/i }
];

function classifyText(text: string | null): AgentKind | null {
  if (!text || text.length === 0) return null;
  for (const { kind, rx } of KIND_PATTERNS) if (rx.test(text)) return kind;
  return null;
}

// B1 fix: psRunner = per-pid lookup; makeProcessTreeFn walks ppid chain
// (cycle-safe, depth-bounded). Tests inject psRunner to prove walker.
export type PsRunner = (pid: number) => { ppid: number; comm: string } | null;
export const defaultPsRunner: PsRunner = (pid) => {
  try {
    const r = spawnSync('ps', ['-o', 'pid=,ppid=,comm=', '-p', String(pid)],
      { encoding: 'utf8', timeout: 2_000 });
    if (r.status !== 0 || !r.stdout) return null;
    const parts = r.stdout.split('\n').map((l) => l.trim()).find((l) => l.length > 0)?.split(/\s+/);
    if (!parts || parts.length < 3) return null;
    const ppid = Number(parts[1]);
    if (!Number.isFinite(ppid)) return null;
    return { ppid, comm: parts.slice(2).join(' ') };
  } catch { return null; }
};
export function makeProcessTreeFn(psRunner: PsRunner = defaultPsRunner): ProcessTreeFn {
  return (pid) => {
    const out: { binary: string; comm: string }[] = [];
    const seen = new Set<number>();
    let current = pid;
    for (let depth = 0; depth < 32; depth += 1) {
      if (current <= 1 || seen.has(current)) break;
      seen.add(current);
      const r = psRunner(current);
      if (!r) break;
      out.push({ binary: r.comm, comm: r.comm });
      if (r.ppid <= 1) break;
      current = r.ppid;
    }
    return out;
  };
}
export const defaultProcessTreeFn: ProcessTreeFn = makeProcessTreeFn();

export const defaultTmuxTitleFn = (terminal: TerminalRow): string | null => {
  const pane = terminal.tmux_target_pane;
  if (!pane || pane.length === 0) return null;
  try {
    const r = spawnSync('tmux', ['display-message', '-p', '-t', pane, '#{pane_title}'],
      { encoding: 'utf8', timeout: 2_000 });
    return r.status === 0 ? ((r.stdout ?? '').trim() || null) : null;
  } catch { return null; }
};
export const defaultDriverVersionFn: DriverVersionFn = (binary) => {
  try {
    const r = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 2_000 });
    if (r.status !== 0 || !r.stdout) return 'unknown';
    return r.stdout.split('\n')[0]?.trim() || 'unknown';
  } catch { return 'unknown'; }
};

type SourceResult = { kind: AgentKind; driver: Driver; confidence: Confidence; evidence: Evidence };

function sourceProcessTree(terminal: TerminalRow, deps: DetectorDeps): SourceResult | null {
  const chain = (deps.processTreeFn ?? defaultProcessTreeFn)(terminal.pid);
  for (const entry of chain) {
    const kind = classifyText(entry.comm);
    if (!kind) continue;
    const version = (deps.driverVersionFn ?? defaultDriverVersionFn)(entry.binary);
    return { kind, driver: { binary: entry.binary, version },
      confidence: 'high', evidence: { source: 'process-tree', detail: entry.comm } };
  }
  return null;
}
function sourceTmuxTitle(terminal: TerminalRow, deps: DetectorDeps): SourceResult | null {
  const title = (deps.tmuxTitleFn ?? defaultTmuxTitleFn)(terminal);
  const kind = classifyText(title); if (!kind) return null;
  return { kind, driver: null, confidence: 'medium', evidence: { source: 'tmux-title', detail: title ?? '' } };
}
function sourceCapture(terminal: TerminalRow, deps: DetectorDeps): SourceResult | null {
  const text = (deps.captureFn ?? defaultTmuxCaptureFn)(terminal);
  const kind = classifyText(text); if (!kind) return null;
  return { kind, driver: null, confidence: 'medium', evidence: { source: 'capture-fn', detail: (text ?? '').slice(0, 80) } };
}
function sourceName(terminal: TerminalRow): SourceResult | null {
  const kind = classifyText(terminal.name); if (!kind) return null;
  return { kind, driver: null, confidence: 'low', evidence: { source: 'name', detail: terminal.name } };
}

function sourceDefault(terminal: TerminalRow): SourceResult {
  return { kind: classifyText(terminal.name) ? 'generic-shell' : 'unknown',
    driver: null, confidence: 'low', evidence: { source: 'default', detail: 'no-signal' } };
}

const SOURCES: Array<(t: TerminalRow, d: DetectorDeps) => SourceResult | null> = [
  sourceProcessTree, sourceTmuxTitle, sourceCapture, (t) => sourceName(t)
];
const SOURCE_LABELS: SourceLabel[] = ['process-tree', 'tmux-title', 'capture-fn', 'name'];

// B2 fix: fallback NAMES the immediately-next source checked even when it
// returns null. Empty only when no next source EXISTS (end of cascade).
function fallbackString(label: SourceLabel | null, next: SourceResult | null): string {
  if (!label) return '';
  if (!next) return `${label}:none`;
  return `${next.evidence.source}:${next.kind}@${next.confidence}`;
}

export function detectFingerprint(terminal: TerminalRow, deps: DetectorDeps = {}): FingerprintDetectionResult {
  let primary: SourceResult | null = null;
  let primaryIdx = -1;
  for (let i = 0; i < SOURCES.length; i += 1) {
    const r = SOURCES[i](terminal, deps);
    if (r && (r.confidence === 'high' || r.confidence === 'medium')) { primary = r; primaryIdx = i; break; }
  }
  if (!primary) { const r = sourceName(terminal); if (r) { primary = r; primaryIdx = 3; } }
  const chosen: SourceResult = primary ?? sourceDefault(terminal);
  let nextLabel: SourceLabel | null = null;
  let next: SourceResult | null = null;
  if (primaryIdx >= 0 && primaryIdx + 1 < SOURCES.length) {
    nextLabel = SOURCE_LABELS[primaryIdx + 1];
    next = SOURCES[primaryIdx + 1](terminal, deps);
  }
  return {
    terminal_id: terminal.id, kind: chosen.kind, driver: chosen.driver,
    confidence: chosen.confidence, fallback: fallbackString(nextLabel, next), evidence: chosen.evidence
  };
}

// M3.2c B2: content-hash debounce skips write entirely on unchanged evidence.
export function applyFingerprintWriteBack(terminal: TerminalRow, result: FingerprintDetectionResult): void {
  if (terminal.agent_kind === 'remote' || terminal.agent_kind === 'browser') return;
  const meta = JSON.parse(terminal.meta || '{}');
  const evidenceStr = `${result.evidence.source}:${result.evidence.detail}`;
  const evidenceHash = createHash('sha256').update(evidenceStr).digest('hex');
  if (meta.fingerprint_evidence_hash === evidenceHash) return;
  const db = getIdentityDb();
  const nowMs = Date.now(), updatedAt = Math.floor(nowMs / 1000);
  meta.fingerprint_at_ms = nowMs;
  meta.fingerprint_evidence = evidenceStr;
  meta.fingerprint_evidence_hash = evidenceHash;
  meta.fingerprint_confidence = result.confidence;
  if (result.confidence === 'high') {
    meta.fingerprint_driver = result.driver;
    db.prepare(`UPDATE terminals SET agent_kind = ?, meta = ?, updated_at = ? WHERE id = ?`)
      .run(result.kind, JSON.stringify(meta), updatedAt, terminal.id);
    return;
  }
  db.prepare(`UPDATE terminals SET meta = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(meta), updatedAt, terminal.id);
}
