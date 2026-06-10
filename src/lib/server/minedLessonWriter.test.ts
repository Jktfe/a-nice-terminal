import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeMinedLesson,
  type MinedLesson,
  type LessonProvenance
} from './minedLessonWriter';

let vaultDir: string;

const SAMPLE_LESSON: MinedLesson = {
  name: 'mined-busy-timeout-prevents-locked-2026-06-10',
  description:
    'Setting busy_timeout on a WAL SQLite handle makes concurrent writers wait rather than fail fast with SQLITE_BUSY.',
  type: 'gotcha',
  scope: 'user',
  rule: 'Set `busy_timeout` on every SQLite handle that shares a file with another writer.',
  why: 'Without it, a concurrent write returns SQLITE_BUSY immediately instead of waiting for the lock to clear, which surfaces as "database is locked" to callers.',
  howToApply: 'Run `db.pragma("busy_timeout = 5000")` right after opening the database, before any prepared statement executes.'
};

const SAMPLE_PROV: LessonProvenance = {
  terminalId: 't-abc',
  windowStartMs: 1_000_000,
  windowEndMs: 2_000_000,
  signals: ['errors', 'long']
};

beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), 'ant-mined-lesson-'));
});

afterEach(() => {
  if (vaultDir && existsSync(vaultDir)) {
    rmSync(vaultDir, { recursive: true, force: true });
  }
});

describe('writeMinedLesson', () => {
  it('writes a file into the given vault dir and reports written=true', () => {
    const res = writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir, nowMs: 1_700_000_000_000 });
    expect(res.written).toBe(true);
    expect(res.skippedDuplicate).toBe(false);
    expect(res.path.startsWith(vaultDir)).toBe(true);
    expect(existsSync(res.path)).toBe(true);
    expect(res.path.endsWith('.md')).toBe(true);
  });

  it('mkdir -p creates a missing nested vault dir', () => {
    const nested = join(vaultDir, 'a', 'b', '_mined');
    const res = writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir: nested });
    expect(res.written).toBe(true);
    expect(existsSync(res.path)).toBe(true);
    expect(res.path.startsWith(nested)).toBe(true);
  });

  it('renders valid memory-pack frontmatter (name/description/type/scope/source + provenance + date)', () => {
    const res = writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir, nowMs: 1_700_000_000_000 });
    const content = readFileSync(res.path, 'utf8');

    // Frontmatter delimiters
    expect(content.startsWith('---\n')).toBe(true);
    const fmEnd = content.indexOf('\n---\n', 4);
    expect(fmEnd).toBeGreaterThan(0);
    const frontmatter = content.slice(4, fmEnd);

    expect(frontmatter).toContain(`name: ${SAMPLE_LESSON.name}`);
    expect(frontmatter).toContain(`description: ${SAMPLE_LESSON.description}`);
    expect(frontmatter).toContain('type: gotcha');
    expect(frontmatter).toContain('scope: user');
    expect(frontmatter).toContain('source: mined-from-firehose');
    // Provenance is auditable back to the firehose window
    expect(frontmatter).toContain('terminal_id: t-abc');
    expect(frontmatter).toContain('window_start_ms: 1000000');
    expect(frontmatter).toContain('window_end_ms: 2000000');
    expect(frontmatter).toContain('signals: errors, long');
    // Date derived from nowMs (UTC date)
    expect(frontmatter).toContain('date: 2023-11-14');
  });

  it('renders the body with title and Rule/Why/How to apply sections', () => {
    const res = writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir });
    const content = readFileSync(res.path, 'utf8');
    const body = content.slice(content.indexOf('\n---\n', 4) + 5);

    expect(body).toMatch(/^# /m); // a title heading
    expect(body).toContain('**Rule:**');
    expect(body).toContain(SAMPLE_LESSON.rule);
    expect(body).toContain('**Why:**');
    expect(body).toContain(SAMPLE_LESSON.why);
    expect(body).toContain('**How to apply:**');
    expect(body).toContain(SAMPLE_LESSON.howToApply);
  });

  it('defaults scope to user when not provided', () => {
    const noScope: MinedLesson = { ...SAMPLE_LESSON };
    delete (noScope as Partial<MinedLesson>).scope;
    const res = writeMinedLesson(noScope, SAMPLE_PROV, { vaultDir });
    const content = readFileSync(res.path, 'utf8');
    expect(content).toContain('scope: user');
  });

  it('skips a second write of the SAME name (skippedDuplicate, written=false)', () => {
    const first = writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir });
    expect(first.written).toBe(true);

    const second = writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir });
    expect(second.written).toBe(false);
    expect(second.skippedDuplicate).toBe(true);
    expect(second.path).toBe(first.path);

    // Only one file landed.
    const mdFiles = readdirSync(vaultDir).filter((f) => f.endsWith('.md'));
    expect(mdFiles.length).toBe(1);
  });

  it('skips a different-name lesson whose description matches an existing file', () => {
    const first = writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir });
    expect(first.written).toBe(true);

    const sameDescDifferentName: MinedLesson = {
      ...SAMPLE_LESSON,
      name: 'mined-some-other-name-2026-06-10'
    };
    const res = writeMinedLesson(sameDescDifferentName, SAMPLE_PROV, { vaultDir });
    expect(res.written).toBe(false);
    expect(res.skippedDuplicate).toBe(true);

    const mdFiles = readdirSync(vaultDir).filter((f) => f.endsWith('.md'));
    expect(mdFiles.length).toBe(1);
  });

  it('writes distinct lessons (different name + description) side by side', () => {
    writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir });
    const other: MinedLesson = {
      name: 'mined-different-thing-2026-06-10',
      description: 'A completely different durable lesson about worktree Spotlight load spikes.',
      type: 'pattern',
      rule: 'Create one git worktree at a time.',
      why: 'Each worktree triggers mdworker Spotlight indexing, spiking load.',
      howToApply: 'Wait for load < 10 before adding the next worktree.'
    };
    const res = writeMinedLesson(other, SAMPLE_PROV, { vaultDir });
    expect(res.written).toBe(true);

    const mdFiles = readdirSync(vaultDir).filter((f) => f.endsWith('.md'));
    expect(mdFiles.length).toBe(2);
  });

  it('escapes a description containing a colon/newline so frontmatter stays parseable', () => {
    const tricky: MinedLesson = {
      ...SAMPLE_LESSON,
      name: 'mined-tricky-desc-2026-06-10',
      description: 'Edge case: a description with a colon, and\na newline in it.'
    };
    const res = writeMinedLesson(tricky, SAMPLE_PROV, { vaultDir });
    const content = readFileSync(res.path, 'utf8');
    // The frontmatter block must still terminate with a clean delimiter and the
    // description must not break out of the YAML scalar onto a bare line.
    const fmEnd = content.indexOf('\n---\n', 4);
    expect(fmEnd).toBeGreaterThan(0);
    const frontmatter = content.slice(4, fmEnd);
    // newline collapsed to a space, kept on the description line
    expect(frontmatter).toContain('description: Edge case: a description with a colon, and a newline in it.');
  });

  it('does not overwrite a pre-existing same-name file written by something else', () => {
    // Simulate a human-promoted/older file already in the dir.
    const res1 = writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir });
    const original = readFileSync(res1.path, 'utf8');
    // Tamper the existing file, then re-run; it must be left untouched.
    writeFileSync(res1.path, original + '\nMANUAL EDIT\n', 'utf8');
    const res2 = writeMinedLesson(SAMPLE_LESSON, SAMPLE_PROV, { vaultDir });
    expect(res2.skippedDuplicate).toBe(true);
    expect(readFileSync(res1.path, 'utf8')).toContain('MANUAL EDIT');
  });
});
