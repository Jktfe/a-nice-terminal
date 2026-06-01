import { describe, expect, it } from 'vitest';
import { extractMarkdownValidationClaimPointers } from './validationMarkdownExtractor';

describe('extractMarkdownValidationClaimPointers', () => {
  it('extracts claim pointers from ObsidiANT-style markdown blocks with line positions', () => {
    const markdown = [
      '---',
      'status: draft',
      'owner: codex3',
      '---',
      '# Validation notes',
      '',
      'Validation should ship with 12 policy checks before launch.',
      '',
      '- Source: board minutes signed by JK.',
      '- This decision changes customer billing.',
      '- Polish note only.',
      '',
      '```',
      'Hidden code has 999 numbers and should not be extracted.',
      '```',
      '',
      '| Claim | Evidence |',
      '| --- | --- |',
      '| Links resolve at https://example.com/spec | file-backed check |'
    ].join('\n');

    const claims = extractMarkdownValidationClaimPointers({
      markdown,
      sourcePointer: 'obsidian:proposals/validation-notes.md',
      url: 'obsidian://open?vault=ObsidiANT&file=proposals/validation-notes.md'
    });

    expect(claims.map((claim) => ({
      kind: claim.kind,
      pointer: claim.source.pointer,
      text: claim.text
    }))).toEqual([
      {
        kind: 'number',
        pointer: 'obsidian:proposals/validation-notes.md#L7',
        text: 'Validation should ship with 12 policy checks before launch.'
      },
      {
        kind: 'source_quality',
        pointer: 'obsidian:proposals/validation-notes.md#L9',
        text: 'Source: board minutes signed by JK.'
      },
      {
        kind: 'claim_material',
        pointer: 'obsidian:proposals/validation-notes.md#L10',
        text: 'This decision changes customer billing.'
      },
      {
        kind: 'claim_nonmaterial',
        pointer: 'obsidian:proposals/validation-notes.md#L11',
        text: 'Polish note only.'
      },
      {
        kind: 'link',
        pointer: 'obsidian:proposals/validation-notes.md#L19',
        text: 'Links resolve at https://example.com/spec | file-backed check'
      }
    ]);
    expect(claims.every((claim) => claim.source.tool === 'doc')).toBe(true);
    expect(claims.every((claim) => claim.source.url?.startsWith('obsidian://'))).toBe(true);
  });

  it('keeps multi-line paragraphs together and points at the covered line range', () => {
    const claims = extractMarkdownValidationClaimPointers({
      markdown: [
        'The validation launch depends on customer approval',
        'and has 3 required reviewers.',
        '',
        '---',
        '',
        '> Quotes are notes, not source claims for this adapter.'
      ].join('\n'),
      sourcePointer: 'room-doc:validation-brief'
    });

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      kind: 'number',
      text: 'The validation launch depends on customer approval and has 3 required reviewers.',
      source: {
        tool: 'doc',
        pointer: 'room-doc:validation-brief#L1-L2'
      }
    });
  });
});
