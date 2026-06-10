/**
 * Pure helpers for slash-command detection in the chat composer.
 *
 * Copied-from: src/lib/components/ChatComposer.svelte:38-47 (M12 break-context)
 * Verdict: KEEP
 * Simplification: lifted to a pure TS module so unit tests can drive the
 *   detection logic without needing a DOM or a Svelte component harness.
 *
 * Backs M03 slice 4 ChatComposer split-before-touch. Mention parsing lives
 * alongside in composerMentions when that lands.
 */

export function looksLikeBreakCommand(rawBody: string): boolean {
  const trimmed = rawBody.trim().toLowerCase();
  return trimmed === '/break' || trimmed.startsWith('/break ');
}

export function reasonFromBreakCommand(rawBody: string): string {
  const trimmed = rawBody.trim();
  const afterSlash = trimmed.slice('/break'.length).trim();
  return afterSlash;
}

/**
 * `/status-poll` — open a milestone status board inline (JWPK msg_39mnm7blal).
 *
 *   /status-poll [complete/in progress/stuck/blocked] "Delivered the thing" --agents [@a @b]
 *
 * Like /break, the composer detects this on send and creates the board
 * instead of posting the raw line. States + participants are optional.
 */
export const DEFAULT_STATUS_STATES = ['complete', 'in progress', 'stuck', 'blocked'] as const;

export type StatusPollCommand = {
  /** Status states (the board's columns). Falls back to DEFAULT_STATUS_STATES. */
  states: string[];
  /** The milestone title (required — null parse if absent). */
  title: string;
  /** Explicit participant handles; empty → caller enrols all room agents. */
  agents: string[];
};

export function looksLikeStatusPollCommand(rawBody: string): boolean {
  const trimmed = rawBody.trim().toLowerCase();
  return trimmed === '/status-poll' || trimmed.startsWith('/status-poll ');
}

/**
 * Parse a `/status-poll` line into {states, title, agents}, or null if it
 * isn't one / has no title. Pure + DOM-free so it's unit-testable.
 */
export function parseStatusPollCommand(rawBody: string): StatusPollCommand | null {
  if (!looksLikeStatusPollCommand(rawBody)) return null;
  let rest = rawBody.trim().slice('/status-poll'.length);

  // --agents [@a @b, @c] — pull it out first so its brackets aren't mistaken
  // for the states bracket. Handles space- and comma-separated handles.
  let agents: string[] = [];
  const agentsMatch = rest.match(/--agents\s*\[([^\]]*)\]/i);
  if (agentsMatch) {
    agents = normaliseHandles(agentsMatch[1]);
    rest = rest.replace(agentsMatch[0], ' ');
  }

  // [state1/state2/...] — the first remaining bracket group is the states.
  let states: string[] = [...DEFAULT_STATUS_STATES];
  const statesMatch = rest.match(/\[([^\]]*)\]/);
  if (statesMatch) {
    const parsed = statesMatch[1]
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parsed.length > 0) states = dedupe(parsed);
    rest = rest.replace(statesMatch[0], ' ');
  }

  // "title" — quoted; else the leftover trimmed text.
  const quoted = rest.match(/"([^"]+)"/);
  const title = (quoted ? quoted[1] : rest).trim();
  if (title.length === 0) return null;

  return { states, title, agents };
}

function normaliseHandles(raw: string): string[] {
  return dedupe(
    raw
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
      .map((h) => (h.startsWith('@') ? h : `@${h}`))
  );
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
