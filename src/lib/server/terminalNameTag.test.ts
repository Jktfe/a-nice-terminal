import { describe, expect, it } from 'vitest';
import {
  baseName,
  isTagged,
  parseArchiveSeq,
  tagArchivedName,
  nextArchiveSeq
} from './terminalNameTag';

describe('baseName', () => {
  it('returns the name unchanged when untagged', () => {
    expect(baseName('terminal3')).toBe('terminal3');
  });
  it('strips a [A] prefix', () => {
    expect(baseName('[A] terminal3')).toBe('terminal3');
  });
  it('strips a [A-2] prefix', () => {
    expect(baseName('[A-12] terminal3')).toBe('terminal3');
  });
  it('strips only one prefix (idempotent re-tag never doubles)', () => {
    expect(baseName('[A] [A] terminal3')).toBe('[A] terminal3');
  });
  it('preserves a base name that itself contains brackets later on', () => {
    expect(baseName('build [stage 2]')).toBe('build [stage 2]');
  });
});

describe('isTagged / parseArchiveSeq', () => {
  it('detects an untagged name', () => {
    expect(isTagged('terminal3')).toBe(false);
    expect(parseArchiveSeq('terminal3')).toBe(0);
  });
  it('reads [A] as sequence 1', () => {
    expect(isTagged('[A] terminal3')).toBe(true);
    expect(parseArchiveSeq('[A] terminal3')).toBe(1);
  });
  it('reads [A-3] as sequence 3', () => {
    expect(parseArchiveSeq('[A-3] terminal3')).toBe(3);
  });
});

describe('tagArchivedName', () => {
  it('uses [A] for sequence 1 (no number)', () => {
    expect(tagArchivedName('terminal3', 1)).toBe('[A] terminal3');
  });
  it('uses [A-N] for sequence >= 2', () => {
    expect(tagArchivedName('terminal3', 2)).toBe('[A-2] terminal3');
    expect(tagArchivedName('terminal3', 5)).toBe('[A-5] terminal3');
  });
  it('tags the BASE even if passed an already-tagged name', () => {
    expect(tagArchivedName('[A] terminal3', 2)).toBe('[A-2] terminal3');
  });
});

describe('nextArchiveSeq', () => {
  it('returns 1 when no tagged siblings exist', () => {
    expect(nextArchiveSeq('terminal3', ['terminal3', 'other'])).toBe(1);
  });
  it('returns 2 when [A] is taken', () => {
    expect(nextArchiveSeq('terminal3', ['[A] terminal3'])).toBe(2);
  });
  it('fills the smallest free slot when there are gaps', () => {
    expect(nextArchiveSeq('terminal3', ['[A] terminal3', '[A-3] terminal3'])).toBe(2);
  });
  it('ignores siblings with a different base', () => {
    expect(nextArchiveSeq('terminal3', ['[A] terminal9', '[A-2] terminal9'])).toBe(1);
  });
});
