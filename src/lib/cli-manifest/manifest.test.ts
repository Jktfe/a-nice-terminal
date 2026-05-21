// Schema-integrity tests for the CLI manifest.
// Protect the three downstream consumers (Discovery docs, deck CLI slides,
// `ant docs generate --from-cli`) from a broken source-of-truth. The
// available-verb source_ref check reads each referenced file from disk so a
// wrapper getting renamed or moved trips the test.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  manifestData,
  listAvailableVerbs,
  listNeedsWrapperVerbs,
  listPlannedVerbs,
  findVerbById,
  type CliManifestVerb,
  type CliVerbStatus,
  type CliVerbRepo,
  type CliFlag
} from './manifest';

const VALID_STATUSES: ReadonlySet<CliVerbStatus> = new Set(['available', 'needs-wrapper', 'planned']);
const VALID_FLAG_TYPES = new Set<CliFlag['type']>(['string', 'number', 'boolean', 'enum']);
const VALID_REPOS: ReadonlySet<CliVerbRepo> = new Set(['fresh-ant', 'v3', 'delivery-plan']);
const FRESH_ANT_ROOT = join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '../../..');
const V3_ROOT = join(FRESH_ANT_ROOT, '..', 'a-nice-terminal');
const DELIVERY_PLAN_ROOT = join(FRESH_ANT_ROOT, '..');

function repoRoot(verb: CliManifestVerb): string {
  const repo = verb.repo ?? 'fresh-ant';
  if (repo === 'v3') return V3_ROOT;
  if (repo === 'delivery-plan') return DELIVERY_PLAN_ROOT;
  return FRESH_ANT_ROOT;
}

function parseOneSourceRef(ref: string, verb: CliManifestVerb): { filePath: string; lineRanges: Array<[number, number]> } {
  const [fileSlug, rangeSlug] = ref.split(':');
  const filePath = join(repoRoot(verb), fileSlug);
  const ranges: Array<[number, number]> = [];
  if (!rangeSlug) return { filePath, lineRanges: ranges };
  for (const piece of rangeSlug.split(',')) {
    const [startRaw, endRaw] = piece.split('-');
    const start = Number(startRaw);
    const end = endRaw === undefined ? start : Number(endRaw);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      ranges.push([start, end]);
    }
  }
  return { filePath, lineRanges: ranges };
}

function parseSourceRefs(ref: string, verb: CliManifestVerb): Array<{ filePath: string; lineRanges: Array<[number, number]> }> {
  return ref.split(';').map((piece) => parseOneSourceRef(piece.trim(), verb));
}

describe('cli-manifest schema integrity', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(manifestData)).toBe(true);
    expect(manifestData.length).toBeGreaterThan(0);
  });

  it('every verb has the required fields with valid shapes', () => {
    for (const verb of manifestData) {
      expect(typeof verb.id, `id missing for ${JSON.stringify(verb)}`).toBe('string');
      expect(verb.id.length, `id empty for ${JSON.stringify(verb)}`).toBeGreaterThan(0);
      expect(typeof verb.primaryVerb, `primaryVerb on ${verb.id}`).toBe('string');
      expect(verb.primaryVerb.length, `primaryVerb empty on ${verb.id}`).toBeGreaterThan(0);
      if (verb.secondaryVerb !== undefined) {
        expect(typeof verb.secondaryVerb, `secondaryVerb on ${verb.id}`).toBe('string');
        expect(verb.secondaryVerb.length).toBeGreaterThan(0);
      }
      expect(typeof verb.usage, `usage on ${verb.id}`).toBe('string');
      expect(verb.usage.length).toBeGreaterThan(0);
      expect(typeof verb.summary, `summary on ${verb.id}`).toBe('string');
      expect(verb.summary.length).toBeGreaterThan(0);
      expect(Array.isArray(verb.flags), `flags on ${verb.id}`).toBe(true);
      expect(typeof verb.canonical_example, `canonical_example on ${verb.id}`).toBe('string');
      expect(verb.canonical_example.length).toBeGreaterThan(0);
      expect(typeof verb.source_ref, `source_ref on ${verb.id}`).toBe('string');
      expect(verb.source_ref.length).toBeGreaterThan(0);
      expect(VALID_STATUSES.has(verb.status), `bad status on ${verb.id}: ${verb.status}`).toBe(true);
    }
  });

  it('every flag has the required fields with valid shapes', () => {
    for (const verb of manifestData) {
      for (const flag of verb.flags) {
        expect(typeof flag.name, `flag.name on ${verb.id}`).toBe('string');
        expect(flag.name.length).toBeGreaterThan(0);
        expect(VALID_FLAG_TYPES.has(flag.type), `bad flag.type on ${verb.id}/${flag.name}: ${flag.type}`).toBe(true);
        expect(typeof flag.summary, `flag.summary on ${verb.id}/${flag.name}`).toBe('string');
        expect(flag.summary.length).toBeGreaterThan(0);
        if (flag.default !== undefined) expect(typeof flag.default).toBe('string');
        if (flag.constraint !== undefined) expect(typeof flag.constraint).toBe('string');
      }
    }
  });

  it('verb ids are unique', () => {
    const ids = manifestData.map((v) => v.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size, `duplicate ids: ${ids.length - uniqueIds.size}`).toBe(ids.length);
  });

  it('every canonical_example starts with "ant " (the CLI binary name)', () => {
    for (const verb of manifestData) {
      expect(verb.canonical_example.startsWith('ant '), `bad example on ${verb.id}: ${verb.canonical_example}`).toBe(true);
    }
  });

  it('available canonical_example contains the primary verb', () => {
    for (const verb of listAvailableVerbs()) {
      const tokens = verb.canonical_example.split(/\s+/);
      expect(tokens.includes(verb.primaryVerb), `${verb.id} example missing primary verb "${verb.primaryVerb}": ${verb.canonical_example}`).toBe(true);
    }
  });

  it('available canonical_example contains the secondary verb when set', () => {
    for (const verb of listAvailableVerbs()) {
      if (verb.secondaryVerb === undefined) continue;
      const tokens = verb.canonical_example.split(/\s+/);
      expect(tokens.includes(verb.secondaryVerb), `${verb.id} example missing secondary "${verb.secondaryVerb}": ${verb.canonical_example}`).toBe(true);
    }
  });
});

describe('cli-manifest source_ref grep validity (available verbs only)', () => {
  // Verbs flagged repo='v3' (or any non-fresh-ant repo) live in a different
  // codebase that isn't checked out alongside this one. Their source_refs
  // point at v3 paths like `cli/commands/plan.ts:160-190` which by design
  // don't exist locally. Skip them so the grep-validity tests only assert
  // on source_refs we own.
  const isLocalRepoVerb = (verb: { repo?: string }) =>
    verb.repo === undefined || verb.repo === 'fresh-ant';

  it('every available source_ref points to an existing file', () => {
    for (const verb of listAvailableVerbs()) {
      if (!isLocalRepoVerb(verb)) continue;
      for (const { filePath } of parseSourceRefs(verb.source_ref, verb)) {
        expect(existsSync(filePath), `available verb ${verb.id} source_ref file missing: ${filePath}`).toBe(true);
      }
    }
  });

  it('every available source_ref line range is within the file', () => {
    for (const verb of listAvailableVerbs()) {
      if (!isLocalRepoVerb(verb)) continue;
      for (const { filePath, lineRanges } of parseSourceRefs(verb.source_ref, verb)) {
        if (lineRanges.length === 0) continue;
        const fileLineCount = readFileSync(filePath, 'utf8').split('\n').length;
        for (const [start, end] of lineRanges) {
          expect(start, `${verb.id} range start ${start} > file len ${fileLineCount}`).toBeLessThanOrEqual(fileLineCount);
          expect(end, `${verb.id} range end ${end} > file len ${fileLineCount}`).toBeLessThanOrEqual(fileLineCount);
        }
      }
    }
  });

  it('every verb has a valid repo (when set) — defaults to fresh-ant', () => {
    for (const verb of manifestData) {
      if (verb.repo === undefined) continue;
      expect(VALID_REPOS.has(verb.repo), `${verb.id} has bad repo: ${verb.repo}`).toBe(true);
    }
  });
});

describe('cli-manifest helpers', () => {
  it('listAvailableVerbs returns only available verbs', () => {
    const subset = listAvailableVerbs();
    expect(subset.length).toBeGreaterThan(0);
    for (const verb of subset) {
      expect(verb.status).toBe('available');
    }
  });

  it('listNeedsWrapperVerbs returns only needs-wrapper verbs (zero is valid — all wrappers shipped)', () => {
    const subset = listNeedsWrapperVerbs();
    // Zero needs-wrapper verbs is now valid: M2.2a/b + M2.3 closures left
    // the manifest with no remaining needs-wrapper entries. The invariant
    // is purity (every entry IS needs-wrapper), not at-least-one.
    for (const verb of subset) {
      expect(verb.status).toBe('needs-wrapper');
    }
  });

  it('listPlannedVerbs returns only planned verbs (may be empty when every planned verb has shipped)', () => {
    const subset = listPlannedVerbs();
    for (const verb of subset) {
      expect(verb.status).toBe('planned');
    }
  });

  it('findVerbById returns the right verb', () => {
    const known: CliManifestVerb | undefined = findVerbById('rooms-list');
    expect(known?.id).toBe('rooms-list');
    expect(known?.status).toBe('available');
    expect(findVerbById('not-a-real-verb')).toBeUndefined();
  });

  it('status-show-v2 is available (M3.4a-v2 shipped 2026-05-14) with rich agent status surface', () => {
    const statusVerb = findVerbById('status-show-v2');
    expect(statusVerb).toBeDefined();
    expect(statusVerb?.status).toBe('available');
    expect(statusVerb?.summary.toLowerCase()).toContain('rich agent status');
    expect(statusVerb?.usage).toContain('--rich');
  });

  it('status-show-v1 is available as the truthful thin pane/terminal delivery status surface', () => {
    const v1 = findVerbById('status-show-v1');
    expect(v1).toBeDefined();
    expect(v1?.status).toBe('available');
    expect(v1?.summary.toLowerCase()).toContain('pane/terminal delivery status');
  });

  it('available verbs with no flags do not advertise -- in usage', () => {
    for (const verb of listAvailableVerbs()) {
      if (verb.flags.length === 0) expect(verb.usage.includes('--'), `${verb.id} usage has -- but no flags`).toBe(false);
    }
  });

  it('subset counts add up to the full manifest', () => {
    const total = listAvailableVerbs().length + listNeedsWrapperVerbs().length + listPlannedVerbs().length;
    expect(total).toBe(manifestData.length);
  });
});
