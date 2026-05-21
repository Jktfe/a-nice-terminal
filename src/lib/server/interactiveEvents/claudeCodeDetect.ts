/**
 * Claude Code interactive-event detector (Layer A T2b lift). Detects
 * a small subset of v3 EventClass kinds via line-suffix heuristics.
 * Conservative: only reports HIGH-CONFIDENCE matches; partial / unclear
 * lines stay in remaining buffer for the next chunk. Per audit doc +
 * banked v3-untouched (full v3 driver port deferred to T2b-impl-2).
 */

import type { Detector, DetectedInteractiveEvent } from './types';

// Confirmation prompt patterns covering real claude-code emissions per
// T2b-impl-2a live-verify findings (2026-05-14): trailing newlines,
// bracketed defaults (Y/n / y/N / [Y/n] / (y/N)), and ?-after-yn order.
//
// Q-then-yn: "Continue? y/n", "Apply? [Y/n]", "Save? (y/N)", default-marked.
const CONF_Q_THEN_YN_RE =
  /\?\s*[\[\(]?\s*[YyNn](?:es)?\s*\/\s*[YyNn]o?\s*[\]\)]?\s*$/i;
// yn-then-Q: "y/n?", "[Y/n]?", "(y/N) ?".
const CONF_YN_THEN_Q_RE =
  /[\[\(]?\s*[YyNn](?:es)?\s*\/\s*[YyNn]o?\s*[\]\)]?\s*\?\s*$/i;
const FREE_TEXT_RE = /:\s*$/; // generic colon-prompt heuristic, eg "Name: "

export const detectClaudeCode: Detector = (buffer) => {
  const events: DetectedInteractiveEvent[] = [];
  if (buffer.length === 0) return { events, consumedBytes: 0 };
  // Chunk-boundary normalisation: trim trailing whitespace/newlines before
  // testing so prompts with a final \n still match (real claude-code emits
  // the prompt then a newline before waiting on input).
  const trimmed = buffer.replace(/[\s\n]+$/, '');
  const lines = trimmed.split('\n');
  const lastNonEmpty = [...lines].reverse().find((l) => l.trimEnd().length > 0) ?? '';
  const candidate = lastNonEmpty.trimEnd();
  if (CONF_Q_THEN_YN_RE.test(candidate) || CONF_YN_THEN_Q_RE.test(candidate)) {
    events.push({ eventClass: 'confirmation', promptText: candidate.trim(), choices: ['yes', 'no'] });
    return { events, consumedBytes: buffer.length };
  }
  if (FREE_TEXT_RE.test(candidate)) {
    events.push({ eventClass: 'free_text', promptText: candidate.trim() });
    return { events, consumedBytes: buffer.length };
  }
  return { events, consumedBytes: 0 };
};
