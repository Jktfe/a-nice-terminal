import { createHash } from 'node:crypto';
import { getLiveBinding } from './handleBindingsStore';
import { findTerminalRecordByHandle, deriveHandle } from './terminalRecordsStore';
import { capturePaneScrollback } from './tmuxPaneSnapshot';

export type LiveAutofillSuggestion = {
  id: string;
  sourceHandle: string;
  text: string;
  copyOnly: true;
  detectedAtMs: number;
  expiresAtMs: number;
  source: 'tmux-dim-text';
};

export type LiveAutofillResult = {
  sourceHandle: string;
  suggestions: LiveAutofillSuggestion[];
  reason?: 'unknown-handle' | 'no-live-pane' | 'no-visible-suggestion';
};

export type CapturePaneScreenFn = (pane: string) => string | null;

const SUGGESTION_TTL_MS = 5_000;
const MAX_SUGGESTIONS = 3;

function canonicalHandle(raw: string): string {
  return `@${raw.trim().replace(/^@+/, '')}`;
}

export const defaultCapturePaneScreen: CapturePaneScreenFn = (pane) => {
  const capture = capturePaneScrollback(pane);
  return capture.length > 0 ? capture : null;
};

function parseSgrCodes(raw: string): number[] {
  if (raw.length === 0) return [0];
  return raw
    .split(';')
    .map((part) => Number(part))
    .filter((code) => Number.isFinite(code));
}

function dimTextSegments(line: string): string[] {
  const segments: string[] = [];
  let dim = false;
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (dim && buffer.length > 0) segments.push(buffer);
    buffer = '';
  };

  while (i < line.length) {
    if (line.charCodeAt(i) === 0x1b && line[i + 1] === '[') {
      const end = line.indexOf('m', i + 2);
      if (end !== -1) {
        flush();
        const codes = parseSgrCodes(line.slice(i + 2, end));
        for (const code of codes) {
          if (code === 0 || code === 22) dim = false;
          if (code === 2) dim = true;
        }
        i = end + 1;
        continue;
      }
    }
    buffer += line[i];
    i += 1;
  }
  flush();
  return segments;
}

function stripControlText(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/[\u2500-\u257f]/g, ' ')
    .replace(/[▌▍█]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyUiChrome(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.length < 3) return true;
  if (!/[a-z0-9]/i.test(text)) return true;
  if (/^(esc|enter|tab|shift|ctrl|control|alt|option|return|backspace)\b/.test(lower)) return true;
  if (/\b(esc to|ctrl\+|press enter|tokens|context|model|cwd|at \d{1,2}:\d{2})\b/.test(lower)) return true;
  if (/^[✓✔✗×•·.\-\s]+$/.test(text)) return true;
  return false;
}

function suggestionId(sourceHandle: string, text: string): string {
  const digest = createHash('sha1').update(`${sourceHandle}\0${text}`).digest('hex').slice(0, 10);
  return `autofill_${digest}`;
}

export function extractLiveAutofillSuggestions(
  captureText: string,
  sourceHandle: string,
  nowMs: number = Date.now()
): LiveAutofillSuggestion[] {
  const lines = captureText.replace(/\r\n?/g, '\n').split('\n').slice(-8);
  const seen = new Set<string>();
  const suggestions: LiveAutofillSuggestion[] = [];

  for (const line of lines) {
    for (const segment of dimTextSegments(line)) {
      const text = stripControlText(segment);
      if (isLikelyUiChrome(text)) continue;
      if (text.length > 240) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      suggestions.push({
        id: suggestionId(sourceHandle, text),
        sourceHandle,
        text,
        copyOnly: true,
        detectedAtMs: nowMs,
        expiresAtMs: nowMs + SUGGESTION_TTL_MS,
        source: 'tmux-dim-text'
      });
      if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
    }
  }

  return suggestions;
}

function paneForHandle(rawHandle: string): { sourceHandle: string; pane: string | null } | null {
  const sourceHandle = canonicalHandle(rawHandle);
  const liveBinding = getLiveBinding(sourceHandle);
  if (liveBinding) return { sourceHandle, pane: liveBinding.pane };

  const record = findTerminalRecordByHandle(sourceHandle);
  if (!record) return null;
  return {
    sourceHandle: deriveHandle(record),
    pane: record.tmux_target_pane
  };
}

export function readLiveAutofillSuggestionsForHandle(
  rawHandle: string,
  opts: { capturePaneScreen?: CapturePaneScreenFn; nowMs?: number } = {}
): LiveAutofillResult {
  const resolved = paneForHandle(rawHandle);
  const sourceHandle = canonicalHandle(rawHandle);
  if (!resolved) return { sourceHandle, suggestions: [], reason: 'unknown-handle' };
  if (!resolved.pane) return { sourceHandle: resolved.sourceHandle, suggestions: [], reason: 'no-live-pane' };

  const capture = (opts.capturePaneScreen ?? defaultCapturePaneScreen)(resolved.pane);
  if (!capture) return { sourceHandle: resolved.sourceHandle, suggestions: [], reason: 'no-visible-suggestion' };
  const suggestions = extractLiveAutofillSuggestions(capture, resolved.sourceHandle, opts.nowMs ?? Date.now());
  return {
    sourceHandle: resolved.sourceHandle,
    suggestions,
    reason: suggestions.length > 0 ? undefined : 'no-visible-suggestion'
  };
}
