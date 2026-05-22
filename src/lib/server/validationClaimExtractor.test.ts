import { describe, expect, it } from 'vitest';
import { extractValidationClaimPointers } from './validationClaimExtractor';

describe('extractValidationClaimPointers', () => {
  it('turns external tool fragments into scored claim pointers without parsing source files', () => {
    const claims = extractValidationClaimPointers({
      source: {
        tool: 'doc',
        pointer: 'gdoc:board-brief',
        url: 'https://docs.example/board-brief'
      },
      fragments: [
        {
          pointer: 'paragraph:3',
          text: 'The launch plan has 12 validation tasks and a 90% acceptance target.'
        },
        {
          pointer: 'paragraph:4',
          text: 'Source: customer board minutes, signed by JK.'
        },
        {
          pointer: 'paragraph:5',
          text: 'Readability polish is mostly done.'
        }
      ]
    });

    expect(claims.map((claim) => ({
      kind: claim.kind,
      text: claim.text,
      pointer: claim.source.pointer,
      url: claim.source.url,
      checks: claim.checks
    }))).toEqual([
      {
        kind: 'number',
        text: 'The launch plan has 12 validation tasks and a 90% acceptance target.',
        pointer: 'gdoc:board-brief#paragraph:3',
        url: 'https://docs.example/board-brief',
        checks: []
      },
      {
        kind: 'source_quality',
        text: 'Source: customer board minutes, signed by JK.',
        pointer: 'gdoc:board-brief#paragraph:4',
        url: 'https://docs.example/board-brief',
        checks: []
      },
      {
        kind: 'claim_nonmaterial',
        text: 'Readability polish is mostly done.',
        pointer: 'gdoc:board-brief#paragraph:5',
        url: 'https://docs.example/board-brief',
        checks: []
      }
    ]);
  });

  it('preserves fragment pointers for sheets, PDFs, and links from existing tool APIs', () => {
    const claims = extractValidationClaimPointers({
      source: {
        tool: 'sheet',
        pointer: 'sheet:Validation'
      },
      fragments: [
        { pointer: 'B7', text: 'Revenue model links to https://example.com/model.' },
        { pointer: 'C9', text: 'This decision changes customer billing.' },
        { pointer: 'D10', text: '   ' }
      ]
    });

    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({
      kind: 'link',
      source: { tool: 'sheet', pointer: 'sheet:Validation#B7' }
    });
    expect(claims[1]).toMatchObject({
      kind: 'claim_material',
      source: { tool: 'sheet', pointer: 'sheet:Validation#C9' }
    });
    expect(claims.every((claim) => claim.id.startsWith('claim_'))).toBe(true);
  });
});
