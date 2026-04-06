// ANT v3 — ANSI Processing
// Utilities for handling ANSI escape sequences in terminal output

const ANSI_REGEX = /\x1B\[[0-9;]*[A-Za-z]|\x1B\][^\x07]*\x07/g;

/** Strip all ANSI escape sequences from text */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/** Split terminal output into lines, preserving empty lines */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Check if a string contains ANSI escape sequences */
export function hasAnsi(text: string): boolean {
  return ANSI_REGEX.test(text);
}

/** Extract text content from a stream of terminal output chunks */
export function extractCleanText(chunks: string[]): string {
  return chunks.map(c => stripAnsi(c)).join('').replace(/\r/g, '');
}
