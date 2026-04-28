export type TerminalActivityState = 'working' | 'thinking' | 'idle';

export const TERMINAL_WORKING_MS = 10_000;
export const TERMINAL_THINKING_MS = 30_000;

export function parseTerminalActivityTime(value?: string | null): number | null {
  if (!value) return null;
  const utc = value.includes('Z') || value.includes('+') ? value : value.replace(' ', 'T') + 'Z';
  const ms = new Date(utc).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function deriveTerminalActivityState(
  lastActivity?: string | null,
  now = Date.now(),
): { state: TerminalActivityState; ageMs: number | null } {
  const activityMs = parseTerminalActivityTime(lastActivity);
  if (activityMs == null) return { state: 'idle', ageMs: null };

  const ageMs = now - activityMs;
  if (ageMs < TERMINAL_WORKING_MS) return { state: 'working', ageMs };
  if (ageMs < TERMINAL_THINKING_MS) return { state: 'thinking', ageMs };
  return { state: 'idle', ageMs };
}

