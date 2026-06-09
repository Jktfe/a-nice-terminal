/**
 * queueCurator — the "curator" tier of the two-tier curated queue (JWPK
 * 2026-06-09, docs/curated-queue-spec.md). It MANAGES the pending queue and
 * does NO model work by default:
 *
 *   - dedupe/coalesce  — fold near-identical pending items into the earliest
 *   - condense         — rule-based trim (seam for a small model later)
 *   - drop-resolved    — conservatively drop an earlier item a later one resolves
 *
 * HARD CONSTRAINT (box-safety, spec §Box-safety): this module — and its tests —
 * are MODEL-FREE. No network, no LLM. The only place a model could ever appear
 * is the INJECTED `opts.condenseFn` seam, and the default is pure string work.
 *
 * Every side-effect goes through the store (coalesce / updateItem / markDropped)
 * so the curator stays pure-ish and testable. `curate` reads the live `pending`
 * list, mutates via the store, and returns a count summary.
 */

import { listQueue, coalesce, updateItem, markDropped, type QueueItem } from './messageQueueStore';

export type CondenseFn = (text: string) => string;

export type CurateOptions = {
  /**
   * INJECTABLE condense seam. Default is a pure rule-based trim (see
   * `defaultCondense`). A real small model could be wired here LATER — never in
   * this module, never in tests.
   */
  condenseFn?: CondenseFn;
  /** Similarity at/above which two normalised texts count as near-dups. Default 0.9. */
  dupThreshold?: number;
  /**
   * Subject-similarity at/above which a LATER item carrying a resolution marker
   * is judged to be "about" an EARLIER item (drop-resolved subject link).
   * Deliberately LOWER than `dupThreshold`: near-identical items are already
   * folded by coalesce, so drop-resolved must catch the related-but-distinct
   * pair (e.g. an ask + an answer that adds words). Kept high enough to stay
   * conservative. Default 0.5.
   */
  resolveSubjectThreshold?: number;
  /** Max curated_text length the default condenser will allow before trimming. Default 600. */
  maxLen?: number;
};

export type CurateSummary = {
  coalesced: number;
  condensed: number;
  dropped: number;
  remaining: number;
};

// ── Text normalisation ──────────────────────────────────────────────────────

/**
 * Normalise for dup-detection (NOT for storage): lowercase, strip leading
 * @mentions, strip leading/surrounding punctuation, collapse all whitespace.
 * Deterministic + pure.
 */
export function normaliseForDup(text: string): string {
  return text
    .toLowerCase()
    // strip leading @mentions (e.g. "@localchair @foo hello" → "hello")
    .replace(/^(?:\s*@[a-z0-9_.-]+\b[,:]?\s*)+/i, '')
    // collapse all whitespace runs to a single space
    .replace(/\s+/g, ' ')
    // strip leading/trailing punctuation + whitespace
    .replace(/^[\s\p{P}]+/u, '')
    .replace(/[\s\p{P}]+$/u, '')
    .trim();
}

// ── Similarity ──────────────────────────────────────────────────────────────

/**
 * Token-set similarity (Jaccard over whitespace tokens) of two ALREADY-normalised
 * strings. 1.0 = identical token set, 0 = disjoint. Pure + order-independent so
 * "fix the build" ≈ "build, fix the". Empty/empty → 1.0; one empty → 0.
 */
export function similarity(aNorm: string, bNorm: string): number {
  if (aNorm === bNorm) return 1;
  const a = new Set(aNorm.split(' ').filter(Boolean));
  const b = new Set(bNorm.split(' ').filter(Boolean));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

// ── Default (model-free) condenser ──────────────────────────────────────────

/**
 * Default rule-based condense: collapse whitespace and cap length at `maxLen`
 * with an ellipsis (cut on a word boundary where possible). PURE — no model.
 */
export function defaultCondense(text: string, maxLen = 600): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLen) return collapsed;
  const slice = collapsed.slice(0, maxLen - 1);
  const lastSpace = slice.lastIndexOf(' ');
  // only honour a word boundary if it doesn't throw away too much
  const cut = lastSpace > maxLen * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

// ── Drop-resolved heuristic ─────────────────────────────────────────────────

/**
 * Resolution markers a LATER item may use to say "the earlier thing is handled".
 * Matched as whole words/phrases, case-insensitively, against the normalised text.
 */
const RESOLUTION_MARKERS: RegExp[] = [
  /\bdone\b/,
  /\bresolved\b/,
  /\bsorted\b/,
  /\bfixed\b/,
  /\bignore that\b/,
  /\bignore the (?:above|last|previous|prior)\b/,
  /\bnvm\b/,
  /\bnever mind\b/,
  /\bno longer needed\b/,
  /\bdisregard\b/
];

export function hasResolutionMarker(normText: string): boolean {
  return RESOLUTION_MARKERS.some((re) => re.test(normText));
}

function shareThread(a: QueueItem, b: QueueItem): boolean {
  if (a.sourceMessageIds.length === 0 || b.sourceMessageIds.length === 0) return false;
  const set = new Set(a.sourceMessageIds);
  return b.sourceMessageIds.some((id) => set.has(id));
}

/**
 * Conservative "does LATER resolve EARLIER?" test. Returns true ONLY when BOTH:
 *   (1) the later item carries an explicit resolution marker, AND
 *   (2) it is provably about the earlier item — either it shares a
 *       source_message_id thread, OR the two share a near-identical subject
 *       (token similarity ≥ dupThreshold after normalisation).
 *
 * Conservative by design: a bare "done" with no thread/subject link drops
 * NOTHING (false-drops are worse than a missed drop — the worker just re-reads it).
 */
export function laterResolvesEarlier(
  earlier: QueueItem,
  later: QueueItem,
  subjectThreshold: number
): boolean {
  const laterNorm = normaliseForDup(later.curatedText);
  if (!hasResolutionMarker(laterNorm)) return false;
  if (shareThread(earlier, later)) return true;
  const earlierNorm = normaliseForDup(earlier.curatedText);
  // Subject-link: strip the later item's resolution markers before comparing so
  // the marker words ("resolved", "done"…) don't dilute the subject overlap.
  const laterSubject = laterNorm
    .replace(/\b(done|resolved|sorted|fixed|nvm|disregard)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return similarity(earlierNorm, laterSubject) >= subjectThreshold;
}

// ── Curate ──────────────────────────────────────────────────────────────────

/**
 * Curate the pending queue for (roomId, targetHandle). Order of operations:
 *   1. dedupe/coalesce — fold near-dups into the EARLIEST item (keep earliest).
 *   2. drop-resolved   — conservatively drop earlier items a later one resolves.
 *   3. condense        — trim each surviving item's curatedText (default rule).
 * Returns count summary. All mutations go through the store.
 */
export function curate(roomId: string, targetHandle: string, opts: CurateOptions = {}): CurateSummary {
  const condenseFn = opts.condenseFn ?? ((t: string) => defaultCondense(t, opts.maxLen ?? 600));
  const dupThreshold = opts.dupThreshold ?? 0.9;
  const resolveSubjectThreshold = opts.resolveSubjectThreshold ?? 0.5;

  let coalesced = 0;
  let condensed = 0;
  let dropped = 0;

  // Snapshot the pending items in priority/FIFO order. The first occurrence of a
  // (near-)dup is the "keeper"; later occurrences fold into it.
  let items = listQueue(roomId, targetHandle, { status: 'pending' });

  // ── 1. dedupe/coalesce ────────────────────────────────────────────────────
  const survivors: QueueItem[] = [];
  const survivorNorms: string[] = [];
  const droppedIds = new Set<string>();

  for (const item of items) {
    const norm = normaliseForDup(item.curatedText);
    let keeperIdx = -1;
    for (let i = 0; i < survivors.length; i++) {
      if (survivorNorms[i] === norm || similarity(survivorNorms[i], norm) >= dupThreshold) {
        keeperIdx = i;
        break;
      }
    }
    if (keeperIdx >= 0) {
      // fold the later item into the earlier keeper, then drop it
      coalesce(survivors[keeperIdx].id, item.id);
      coalesced++;
      droppedIds.add(item.id);
    } else {
      survivors.push(item);
      survivorNorms.push(norm);
    }
  }

  // ── 2. drop-resolved ──────────────────────────────────────────────────────
  // For each surviving (earlier) item, see if any LATER surviving item resolves
  // it. Conservative: explicit marker + thread-or-subject link required.
  for (let i = 0; i < survivors.length; i++) {
    const earlier = survivors[i];
    if (droppedIds.has(earlier.id)) continue;
    for (let j = i + 1; j < survivors.length; j++) {
      const later = survivors[j];
      if (droppedIds.has(later.id)) continue;
      if (laterResolvesEarlier(earlier, later, resolveSubjectThreshold)) {
        markDropped(earlier.id);
        dropped++;
        droppedIds.add(earlier.id);
        break;
      }
    }
  }

  // ── 3. condense ───────────────────────────────────────────────────────────
  for (const item of survivors) {
    if (droppedIds.has(item.id)) continue;
    const next = condenseFn(item.curatedText);
    if (next !== item.curatedText) {
      updateItem(item.id, { curatedText: next });
      condensed++;
    }
  }

  const remaining = listQueue(roomId, targetHandle, { status: 'pending' }).length;
  return { coalesced, condensed, dropped, remaining };
}
