/**
 * minedLessonWriter — render a firehose-mined lesson as a memory-pack `.md`
 * file and write it into the STAGED review area (`memory-pack/_mined/`).
 *
 * Per the firehose mining design spec (2026-06-10-firehose-mining-design.md,
 * "Vault writer — staged review area"): surviving lessons land in
 * `_mined/`, NOT the trusted vault root, with frontmatter provenance
 * (`source: mined-from-firehose`, the session terminal + ts range, the
 * qualifying signals) so each lesson is auditable back to its transcript and
 * distinguishable from human-confirmed memories. Promotion to the trusted
 * vault is a manual skim — this module only stages.
 *
 * Behaviour-preserving guarantees:
 *  - Pure file write (node:fs), no DB / network.
 *  - mkdir -p the target dir.
 *  - DEDUP: skip when a file with the SAME name already exists, OR when an
 *    existing `_mined` file's `description` frontmatter matches this lesson's
 *    (so a recurring pattern doesn't spawn near-duplicate files). A skip never
 *    overwrites the pre-existing file.
 *  - Frontmatter stays YAML-parseable: scalar values that could break the
 *    `key: value` line (newlines, leading/trailing space) are normalised onto
 *    a single line.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type MinedLesson = {
  name: string;
  description: string;
  type: 'feedback' | 'gotcha' | 'pattern' | 'reference';
  scope?: string;
  rule: string;
  why: string;
  howToApply: string;
};

export type LessonProvenance = {
  terminalId: string;
  windowStartMs: number;
  windowEndMs: number;
  signals: string[];
};

export type WriteMinedLessonResult = {
  path: string;
  written: boolean;
  skippedDuplicate: boolean;
};

const SOURCE_TAG = 'mined-from-firehose';

/** Default staged review area — a sibling of the trusted vault, never its root. */
function defaultVaultDir(): string {
  return join(homedir(), 'CascadeProjects', 'ObsidiANT', 'memory-pack', '_mined');
}

/**
 * Collapse a value to a single safe YAML scalar line. Frontmatter here is a
 * flat `key: value` block, so any embedded newline or run of whitespace would
 * either break the scalar onto a bare line or trip a YAML parser. We fold all
 * whitespace (including newlines) to single spaces and trim the ends. Colons
 * inside the value are fine on the value side of the first `: ` so they're
 * left intact (matches how the existing hand-written memory-pack files read).
 */
function yamlScalar(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** A `# Title` for the body, derived from the description's first clause/sentence. */
function deriveTitle(lesson: MinedLesson): string {
  const firstSentence = lesson.description.split(/(?<=[.!?])\s/)[0] ?? lesson.description;
  const oneLine = yamlScalar(firstSentence).replace(/[.:]+$/, '');
  return oneLine.length > 0 ? oneLine : yamlScalar(lesson.name);
}

/** UTC YYYY-MM-DD for the frontmatter `date:` stamp. */
function utcDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function renderLesson(lesson: MinedLesson, prov: LessonProvenance, nowMs: number): string {
  const scope = lesson.scope && lesson.scope.trim().length > 0 ? lesson.scope.trim() : 'user';
  const signals = prov.signals.join(', ');
  const frontmatter = [
    '---',
    `name: ${yamlScalar(lesson.name)}`,
    `description: ${yamlScalar(lesson.description)}`,
    `type: ${lesson.type}`,
    `scope: ${scope}`,
    `source: ${SOURCE_TAG}`,
    `terminal_id: ${yamlScalar(prov.terminalId)}`,
    `window_start_ms: ${prov.windowStartMs}`,
    `window_end_ms: ${prov.windowEndMs}`,
    `signals: ${signals}`,
    `date: ${utcDate(nowMs)}`,
    '---'
  ].join('\n');

  const body = [
    `# ${deriveTitle(lesson)}`,
    '',
    `**Rule:** ${lesson.rule.trim()}`,
    '',
    `**Why:** ${lesson.why.trim()}`,
    '',
    `**How to apply:** ${lesson.howToApply.trim()}`,
    ''
  ].join('\n');

  return `${frontmatter}\n\n${body}`;
}

/** Read the `description:` frontmatter line of an existing `_mined` file, if any. */
function existingDescription(filePath: string): string | null {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  if (!content.startsWith('---\n')) return null;
  const fmEnd = content.indexOf('\n---\n', 4);
  if (fmEnd < 0) return null;
  const frontmatter = content.slice(4, fmEnd);
  for (const line of frontmatter.split('\n')) {
    const match = /^description:\s*(.*)$/.exec(line);
    if (match) return yamlScalar(match[1]);
  }
  return null;
}

/** True if any existing `.md` in the dir already carries this description. */
function descriptionAlreadyPresent(vaultDir: string, description: string): boolean {
  const target = yamlScalar(description);
  if (target.length === 0) return false;
  let entries: string[];
  try {
    entries = readdirSync(vaultDir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    if (existingDescription(join(vaultDir, entry)) === target) return true;
  }
  return false;
}

/** A filesystem-safe filename for the lesson (its name, slugged, `.md`). */
function fileNameFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug.length > 0 ? slug : 'mined-lesson';
  return base.endsWith('.md') ? base : `${base}.md`;
}

export function writeMinedLesson(
  lesson: MinedLesson,
  prov: LessonProvenance,
  opts?: { vaultDir?: string; nowMs?: number }
): WriteMinedLessonResult {
  const vaultDir = opts?.vaultDir ?? defaultVaultDir();
  const nowMs = opts?.nowMs ?? Date.now();

  mkdirSync(vaultDir, { recursive: true });

  const path = join(vaultDir, fileNameFor(lesson.name));

  // DEDUP — same name OR matching description already staged → leave untouched.
  if (existsSync(path) || descriptionAlreadyPresent(vaultDir, lesson.description)) {
    return { path, written: false, skippedDuplicate: true };
  }

  writeFileSync(path, renderLesson(lesson, prov, nowMs), 'utf8');
  return { path, written: true, skippedDuplicate: false };
}
