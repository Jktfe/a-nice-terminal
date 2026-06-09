import { describe, it, expect } from 'vitest';
import { parseType, parseLinks, parseVaultEntry, sweepVault, type VaultFile } from './vaultSweep';

const NOW = 2_000_000_000_000;
const fresh = NOW - 60_000; // 1 min ago
const old = NOW - 40 * 24 * 60 * 60 * 1000; // 40 days → recency 0

const fm = (name: string, type: string, body = '') =>
  `---\nname: ${name}\ndescription: x\nmetadata:\n  type: ${type}\n---\n${body}`;

describe('frontmatter + link parsing', () => {
  it('parseType reads metadata.type, defaults reference', () => {
    expect(parseType(fm('a', 'feedback'))).toBe('feedback');
    expect(parseType(fm('a', 'project'))).toBe('project');
    expect(parseType('no frontmatter here')).toBe('reference');
    expect(parseType(fm('a', 'bogus'))).toBe('reference');
  });
  it('parseLinks extracts + dedupes [[links]]', () => {
    expect(parseLinks('see [[alpha]] and [[beta]] and [[alpha]]').sort()).toEqual(['alpha', 'beta']);
    expect(parseLinks('no links')).toEqual([]);
  });
  it('parseVaultEntry tags gotcha files', () => {
    const p = parseVaultEntry({ id: 'gotcha_thing', content: fm('gotcha_thing', 'feedback'), storedAtMs: NOW });
    expect(p.entry.tags).toContain('gotcha');
    expect(p.entry.type).toBe('feedback');
  });
});

describe('sweepVault — read-only candidate selection', () => {
  it('selects high-signal fresh entries, drops low/old ones (threshold 60)', () => {
    const files: VaultFile[] = [
      { id: 'hot', content: fm('hot', 'feedback', 'rule'), storedAtMs: fresh }, // 30+20(tag)+15 = 65
      { id: 'cold', content: fm('cold', 'reference', 'note'), storedAtMs: old } // 0+0+0 = 0
    ];
    const c = sweepVault(files, NOW, 60);
    expect(c.map((x) => x.id)).toEqual(['hot']);
  });

  it('backlinks lift the score (referencedBy signal from [[links]])', () => {
    const files: VaultFile[] = [
      { id: 'hub', content: fm('hub', 'decision', 'core'), storedAtMs: fresh }, // 30+20+15 = 65 base
      { id: 'a', content: fm('a', 'reference', 'see [[hub]]'), storedAtMs: fresh },
      { id: 'b', content: fm('b', 'reference', 'see [[hub]]'), storedAtMs: fresh },
      { id: 'c', content: fm('c', 'reference', 'see [[hub]]'), storedAtMs: fresh },
      { id: 'd', content: fm('d', 'reference', 'see [[hub]]'), storedAtMs: fresh },
      { id: 'e', content: fm('e', 'reference', 'see [[hub]]'), storedAtMs: fresh }
    ];
    // hub: 65 base + 5 backlinks * 5 = 90 → qualifies at default threshold 90
    const c = sweepVault(files, NOW);
    expect(c.map((x) => x.id)).toContain('hub');
    expect(c.find((x) => x.id === 'hub')!.score).toBe(90);
  });

  it('default threshold (90) is conservative — a fresh tagged decision alone is not enough', () => {
    const files: VaultFile[] = [{ id: 'solo', content: fm('solo', 'decision', 'x'), storedAtMs: fresh }];
    expect(sweepVault(files, NOW)).toHaveLength(0); // 65 < 90
  });

  it('returns candidates highest-score first', () => {
    const files: VaultFile[] = [
      { id: 'low', content: fm('low', 'project', 'p'), storedAtMs: fresh }, // 0+0+15=15
      { id: 'high', content: fm('high', 'feedback', 'f'), storedAtMs: fresh } // 30+20+15=65
    ];
    const c = sweepVault(files, NOW, 10);
    expect(c[0].id).toBe('high');
    expect(c[0].score).toBeGreaterThan(c[1].score);
  });
});
