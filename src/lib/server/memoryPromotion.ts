/**
 * Memory promotion — the #2 competitor-sweep lift (wayland's promotion loop),
 * adapted to ANT's markdown+frontmatter vault.
 *
 * Scores memory entries and selects which earn auto-graduation into the durable
 * layer, so the hand-curated vault gains the automatic "dreaming" sweep wayland
 * ships. ANT's `[[backlinks]]` are the equivalent of wayland's `referencedBy`
 * signal, so the scoring input already exists in our format.
 *
 * Pure + side-effect-free (no I/O, no Date.now — `nowMs` is injected) so it's
 * fully unit-tested; a caller wires it to the vault dir + a periodic sweep.
 * A WorkspaceIdentity `evidenceReceipt` plugs in as just another PromotableEntry
 * (type 'decision'/'pattern' with its refs), so the card→receipt→promotion
 * pipeline composes without this module knowing about cards.
 *
 * Spec: docs/concepts/ant-memory-layers.md + the competitor-sweep readback.
 */

/** Entry kinds we score. ANT auto-memory types + wayland's high-signal kinds. */
export type MemoryEntryType =
  | 'user'
  | 'feedback'
  | 'project'
  | 'reference'
  | 'decision'
  | 'pattern'
  | 'observation'
  | 'session';

export interface PromotableEntry {
  id: string;
  type: MemoryEntryType;
  tags: string[];
  /** How many other entries [[link]] to this one (ANT backlinks = wayland referencedBy). */
  backlinkCount: number;
  /** References from entries in *other* projects (stronger signal than same-project). */
  crossProjectRefs: number;
  /** When the entry was stored (epoch ms). Drives the recency boost. */
  storedAtMs: number;
}

/** Types that are inherently high-signal (durable by nature). */
const HIGH_SIGNAL_TYPES: ReadonlySet<MemoryEntryType> = new Set<MemoryEntryType>([
  'decision',
  'pattern',
  'feedback'
]);

/** Tags that mark an entry as promotion-worthy. */
const PROMOTED_TAGS: ReadonlySet<string> = new Set([
  'decision',
  'pattern',
  'global',
  'design',
  'architecture',
  'feedback',
  'gotcha'
]);

const RECENCY_PEAK_MS = 24 * 60 * 60 * 1000; // full boost under 24h
const RECENCY_MAX_MS = 30 * 24 * 60 * 60 * 1000; // decays to 0 at 30d

/**
 * Promotion score 0–100 (wayland's formula, ANT-tuned):
 *   +30 high-signal type (decision/pattern/feedback)
 *   +10 per cross-project reference
 *   +5  per backlink (referencedBy)
 *   +20 if any tag is promotion-worthy
 *   +15 recency boost: full < 24h, linear decay to 0 at 30d
 *   capped 0..100
 */
export function computePromotionScore(entry: PromotableEntry, nowMs: number): number {
  let score = 0;

  if (HIGH_SIGNAL_TYPES.has(entry.type)) score += 30;
  score += entry.crossProjectRefs * 10;
  score += entry.backlinkCount * 5;
  if (entry.tags.some((t) => PROMOTED_TAGS.has(t.toLowerCase()))) score += 20;

  const ageMs = nowMs - entry.storedAtMs;
  if (ageMs <= RECENCY_PEAK_MS) {
    score += 15;
  } else if (ageMs < RECENCY_MAX_MS) {
    const decay = 1 - (ageMs - RECENCY_PEAK_MS) / (RECENCY_MAX_MS - RECENCY_PEAK_MS);
    score += Math.round(15 * decay);
  }

  return Math.min(100, Math.max(0, score));
}

export interface PromotionCandidate {
  id: string;
  score: number;
}

/**
 * Score every entry and return those at/above `threshold`, highest first.
 * Default threshold 90 mirrors wayland's sweep default (conservative — only the
 * clearest winners auto-graduate; everything else stays put).
 */
export function selectPromotionCandidates(
  entries: ReadonlyArray<PromotableEntry>,
  nowMs: number,
  threshold = 90
): PromotionCandidate[] {
  return entries
    .map((e) => ({ id: e.id, score: computePromotionScore(e, nowMs) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/** An entry's outbound links (the `[[name]]` refs in its body), by entry id. */
export interface LinkedEntry {
  id: string;
  /** ids this entry links to (resolved [[name]] targets). */
  links: ReadonlyArray<string>;
}

/**
 * Build the backlink count for every entry id: how many *other* entries link to
 * it. Self-links don't count; links to unknown ids are ignored. This turns the
 * vault's `[[backlinks]]` into the `backlinkCount` the score consumes.
 */
export function computeBacklinkCounts(entries: ReadonlyArray<LinkedEntry>): Map<string, number> {
  const known = new Set(entries.map((e) => e.id));
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.id, 0);
  for (const e of entries) {
    for (const target of new Set(e.links)) {
      if (target === e.id || !known.has(target)) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}
