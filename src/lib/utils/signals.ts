// ANT v3 — Terminal Signal Classifier
// Parses raw terminal output into actionable signals

export type Signal =
  | { type: 'error'; message: string }
  | { type: 'success'; message: string }
  | { type: 'prompt'; message: string; options: string[] }
  | { type: 'collapsed'; lineCount: number; summary: string }
  | { type: 'normal'; message: string };

const ERROR_PATTERN = /\berror\b|\bError\b|ENOENT|✖|✗|\bfailed\b|\bFAILED\b|TS\d+:/i;
const SUCCESS_PATTERN = /✓|✔|success|done|complete|built in/i;
const VERBOSE_PATTERN = /node_modules|downloading|resolving|fetching|npm warn/i;
const ANSI_REGEX = /\x1B\[[0-9;]*[A-Za-z]|\x1B\][^\x07]*\x07/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

export function classifyLine(raw: string): Signal {
  const line = stripAnsi(raw).trim();
  if (!line) return { type: 'normal', message: '' };

  // Check for interactive prompts
  const interactionKeywords = ['allow', 'continue', 'overwrite', 'delete', 'proceed', 'confirm', 'install', 'replace'];
  const isInteractive = line.endsWith('?') && interactionKeywords.some(k => line.toLowerCase().includes(k));

  if (line.endsWith('[y/N]') || line.endsWith('[Y/n]') || line.endsWith('(yes/no)') || isInteractive) {
    const options = line.includes('[y/N]') || line.includes('[Y/n]')
      ? ['y', 'n']
      : line.includes('(yes/no)')
        ? ['yes', 'no']
        : [];
    return { type: 'prompt', message: line, options };
  }

  if (ERROR_PATTERN.test(line)) return { type: 'error', message: line };
  if (SUCCESS_PATTERN.test(line)) return { type: 'success', message: line };

  return { type: 'normal', message: line };
}

export function classifyBatch(rawLines: string[]): Signal[] {
  const result: Signal[] = [];
  let verboseBurst: string[] = [];

  function flushBurst() {
    if (verboseBurst.length === 0) return;
    if (verboseBurst.length >= 3) {
      result.push({ type: 'collapsed', lineCount: verboseBurst.length, summary: verboseBurst[0] });
    } else {
      verboseBurst.forEach(l => result.push({ type: 'normal', message: l }));
    }
    verboseBurst = [];
  }

  for (const raw of rawLines) {
    const clean = stripAnsi(raw).trim();
    if (VERBOSE_PATTERN.test(clean)) {
      verboseBurst.push(clean);
    } else {
      flushBurst();
      result.push(classifyLine(raw));
    }
  }
  flushBurst();
  return result;
}
