/**
 * Constitution compose — the injection MECHANISM (the wayland `composePrompt`
 * pattern, lifted to ANT).
 *
 * Builds the Anthropic `system` field as an array of content blocks where the
 * CONSTITUTION PREFIX (constitution + optional per-role overlay) is turn-stable
 * and carries `cache_control: { type: 'ephemeral' }`. Because the prefix is
 * byte-identical on every turn, it hits the prompt cache. Per-turn VOLATILE
 * context (today's date, the room, the turn state) is a SEPARATE block placed
 * AFTER the cache breakpoint, so it can change every turn without invalidating
 * the cached prefix.
 *
 * The one rule callers must honour: nothing volatile in the prefix. The prefix
 * is asserted turn-stable (no timestamps / dates / ids), so a regression fails
 * loudly instead of silently busting the cache for every agent.
 */

export interface EphemeralCacheControl {
  type: 'ephemeral';
}

/** A single Anthropic `system` content block. */
export interface SystemTextBlock {
  type: 'text';
  text: string;
  cache_control?: EphemeralCacheControl;
}

export interface ComposeConstitutionInput {
  /** Versioned constitution.md content — the stable core. Required. */
  constitution: string;
  /** Optional per-role overlay (stable per role); appended into the cached prefix. */
  roleOverlay?: string;
  /**
   * Per-turn volatile context (date, room, turn state). Emitted as its own block
   * AFTER the cache breakpoint — never folded into the cached prefix.
   */
  volatileContext?: string;
}

/** Patterns that betray volatile content leaking into the cached prefix. */
const VOLATILE_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'ISO timestamp', re: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/ },
  { name: 'ISO date', re: /\b\d{4}-\d{2}-\d{2}\b/ },
  { name: 'clock time', re: /\b\d{1,2}:\d{2}(?::\d{2})?\b/ },
  { name: 'epoch milliseconds', re: /\b1[0-9]{12}\b/ },
  {
    name: 'uuid',
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
  },
  // Turn / message counters — the classic "looks stable but ticks every turn"
  // leak. Matches turn=3, turn 3, turn#3, turn-3, message #12, msg 7.
  { name: 'turn/message counter', re: /\b(?:turn|message|msg)\s*[#=:-]?\s*\d+\b/i }
];

export class TurnStabilityError extends Error {
  constructor(
    public readonly pattern: string,
    public readonly match: string
  ) {
    super(
      `Constitution prefix is not turn-stable: contains ${pattern} ("${match}"). ` +
        `Move volatile content out of the cached prefix and into volatileContext.`
    );
    this.name = 'TurnStabilityError';
  }
}

/** Throws {@link TurnStabilityError} if `text` contains volatile content. */
export function assertTurnStable(text: string): void {
  for (const { name, re } of VOLATILE_PATTERNS) {
    const found = re.exec(text);
    if (found) throw new TurnStabilityError(name, found[0]);
  }
}

/** Join parts deterministically: trim trailing whitespace only, drop empties. */
function joinStable(parts: ReadonlyArray<string | undefined>): string {
  return parts
    .map((part) => (part ?? '').replace(/\s+$/u, ''))
    .filter((part) => part.length > 0)
    .join('\n\n');
}

/**
 * Compose the system prompt as cache-friendly content blocks.
 *
 * - Block 0 = the constitution prefix (constitution + role overlay), turn-stable,
 *   `cache_control: { type: 'ephemeral' }`.
 * - Block 1 (optional) = the volatile context, AFTER the breakpoint, no
 *   `cache_control`.
 *
 * @throws {TurnStabilityError} if the prefix contains volatile content.
 * @throws {Error} if the constitution is empty.
 */
export function composeSystemPrompt(input: ComposeConstitutionInput): SystemTextBlock[] {
  const prefix = joinStable([input.constitution, input.roleOverlay]);
  if (prefix.length === 0) {
    throw new Error('composeSystemPrompt: constitution is empty — nothing to cache.');
  }
  assertTurnStable(prefix);

  const blocks: SystemTextBlock[] = [
    { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } }
  ];

  const volatile = (input.volatileContext ?? '').replace(/\s+$/u, '');
  if (volatile.length > 0) {
    // No cache_control — this block lives past the breakpoint and is allowed to
    // change every turn without busting the cached prefix.
    blocks.push({ type: 'text', text: volatile });
  }

  return blocks;
}
