/**
 * Pure helpers for the archived-terminal name tag `[A] <base>` /
 * `[A-N] <base>`. No DB access — all functions are total and testable in
 * isolation. Spec: docs/specs/2026-05-31-archived-terminal-name-tagging-design.md
 *
 * Tagging frees the base name in the global UNIQUE index on terminals.name
 * (and terminal_records.name) the moment a terminal is archived, so a fresh
 * or revived terminal can reuse it. `[A]` is sequence 1 (number omitted);
 * `[A-2]`, `[A-3]` … are subsequent archives of the same base.
 */

// Matches a single leading tag prefix only — so re-tagging never doubles up.
const TAG_PREFIX = /^\[A(?:-(\d+))?\] /;

/** The name with any single leading `[A]` / `[A-N]` prefix removed. */
export function baseName(name: string): string {
  return name.replace(TAG_PREFIX, '');
}

/** True when the name carries a leading archive tag. */
export function isTagged(name: string): boolean {
  return TAG_PREFIX.test(name);
}

/** Sequence number encoded in the tag: `[A]`=1, `[A-N]`=N, untagged=0. */
export function parseArchiveSeq(name: string): number {
  const m = TAG_PREFIX.exec(name);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : 1;
}

/** Build the tagged name for a given base at sequence `seq` (>=1). */
export function tagArchivedName(name: string, seq: number): string {
  const base = baseName(name);
  return seq <= 1 ? `[A] ${base}` : `[A-${seq}] ${base}`;
}

/**
 * Smallest free sequence (>=1) for `base` given a list of existing names.
 * Only names whose base matches `base` and which are tagged are considered.
 */
export function nextArchiveSeq(base: string, existingNames: string[]): number {
  const used = new Set<number>();
  for (const name of existingNames) {
    if (isTagged(name) && baseName(name) === base) {
      used.add(parseArchiveSeq(name));
    }
  }
  let seq = 1;
  while (used.has(seq)) seq++;
  return seq;
}
