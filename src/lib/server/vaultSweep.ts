/**
 * vaultSweep — read-only pass over the markdown+frontmatter memory vault that
 * scores every entry (via memoryPromotion) and returns the promotion candidates.
 *
 * This is the "sweep" layer on top of the scoring engine: it parses each vault
 * file's frontmatter (type), its `[[backlinks]]`, and a stored timestamp, builds
 * the link graph, and selects entries that earn auto-graduation into the durable
 * layer. It IDENTIFIES candidates only — it never moves/edits a memory (the
 * actual graduation is a separate, gated step, per ant-memory-layers: one fact
 * per lane, no silent duplication). Pure: the caller supplies the file list +
 * clock, so it's fully unit-tested and does no I/O itself.
 */

import {
  computeBacklinkCounts,
  selectPromotionCandidates,
  type MemoryEntryType,
  type PromotableEntry,
  type LinkedEntry,
  type PromotionCandidate
} from './memoryPromotion';

export interface VaultFile {
  /** Stable id — the file's frontmatter `name`, or its filename slug. */
  id: string;
  /** Raw file text (frontmatter + body). */
  content: string;
  /** When the entry was stored (file mtime epoch ms) — drives the recency boost. */
  storedAtMs: number;
}

const TYPE_MAP: Record<string, MemoryEntryType> = {
  user: 'user',
  feedback: 'feedback',
  project: 'project',
  reference: 'reference',
  decision: 'decision',
  pattern: 'pattern',
  observation: 'observation',
  session: 'session'
};

/** Pull `metadata.type:` (or a top-level `type:`) out of the frontmatter block. */
export function parseType(content: string): MemoryEntryType {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  const block = fm ? fm[1] : content.slice(0, 400);
  const m = block.match(/^\s*type:\s*([a-z]+)/im);
  return (m && TYPE_MAP[m[1].toLowerCase()]) || 'reference';
}

/** Extract `[[link]]` targets from the body (deduped, trimmed). */
export function parseLinks(content: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const t = m[1].trim();
    if (t) out.add(t);
  }
  return [...out];
}

/** Tags = the type + any promotion-worthy markers detectable from id/content. */
function tagsFor(id: string, type: MemoryEntryType): string[] {
  const tags: string[] = [type];
  if (/gotcha/i.test(id)) tags.push('gotcha');
  if (/feedback/i.test(id)) tags.push('feedback');
  return tags;
}

export interface ParsedVaultEntry {
  entry: Omit<PromotableEntry, 'backlinkCount'>;
  links: string[];
}

/** Parse one file into a (pre-backlink) promotable entry + its outbound links. */
export function parseVaultEntry(file: VaultFile): ParsedVaultEntry {
  const type = parseType(file.content);
  return {
    entry: { id: file.id, type, tags: tagsFor(file.id, type), crossProjectRefs: 0, storedAtMs: file.storedAtMs },
    links: parseLinks(file.content)
  };
}

/**
 * Sweep the vault: parse → build the backlink graph → score → select.
 * Returns promotion candidates (≥ threshold), highest first. Read-only.
 */
export function sweepVault(
  files: ReadonlyArray<VaultFile>,
  nowMs: number,
  threshold = 90
): PromotionCandidate[] {
  const parsed = files.map(parseVaultEntry);
  const linked: LinkedEntry[] = parsed.map((p) => ({ id: p.entry.id, links: p.links }));
  const backlinks = computeBacklinkCounts(linked);
  const entries: PromotableEntry[] = parsed.map((p) => ({
    ...p.entry,
    backlinkCount: backlinks.get(p.entry.id) ?? 0
  }));
  return selectPromotionCandidates(entries, nowMs, threshold);
}
