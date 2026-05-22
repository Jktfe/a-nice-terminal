import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractMarkdownFileValidationClaimPointers } from './validationMarkdownFileExtractor';

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('extractMarkdownFileValidationClaimPointers', () => {
  it('reads one local markdown file and returns source-linked claim pointers', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ant-validation-md-'));
    const filePath = join(tempDir, 'speed-pact-handoff.md');
    writeFileSync(
      filePath,
      [
        '---',
        'title: Speed Pact handoff',
        '---',
        '# Morning handoff',
        '',
        '- 15 PRs merged to main + 8 direct commits = 24 commits ahead.',
        '- Source: overnight room transcript signed by JK.',
        '',
        '```',
        'hidden 999 should not extract',
        '```'
      ].join('\n'),
      'utf8'
    );

    const claims = extractMarkdownFileValidationClaimPointers({
      filePath,
      sourcePointer: 'obsidian:research/speed-pact-handoff.md',
      url: 'obsidian://open?vault=ObsidiANT&file=research/speed-pact-handoff.md'
    });

    expect(claims.map((claim) => ({
      kind: claim.kind,
      pointer: claim.source.pointer,
      url: claim.source.url,
      text: claim.text
    }))).toEqual([
      {
        kind: 'number',
        pointer: 'obsidian:research/speed-pact-handoff.md#L6',
        url: 'obsidian://open?vault=ObsidiANT&file=research/speed-pact-handoff.md',
        text: '15 PRs merged to main + 8 direct commits = 24 commits ahead.'
      },
      {
        kind: 'source_quality',
        pointer: 'obsidian:research/speed-pact-handoff.md#L7',
        url: 'obsidian://open?vault=ObsidiANT&file=research/speed-pact-handoff.md',
        text: 'Source: overnight room transcript signed by JK.'
      }
    ]);
  });
});
