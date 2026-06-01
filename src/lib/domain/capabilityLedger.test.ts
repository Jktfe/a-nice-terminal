import { describe, expect, it } from 'vitest';
import { firstCapabilityRows } from './capabilityLedger';

describe('capabilityLedger', () => {
  it('has 5 capability rows', () => {
    expect(firstCapabilityRows).toHaveLength(5);
  });

  it('every row has required fields', () => {
    for (const row of firstCapabilityRows) {
      expect(row.capability).toBeTruthy();
      expect(row.source).toBeTruthy();
      expect(row.status).toBeTruthy();
      expect(row.owner).toBeTruthy();
      expect(row.note).toBeTruthy();
    }
  });

  it('status values are CHANGE', () => {
    for (const row of firstCapabilityRows) {
      expect(row.status).toBe('CHANGE');
    }
  });

  it('owners are Claude or Codex', () => {
    for (const row of firstCapabilityRows) {
      expect(['Claude', 'Codex']).toContain(row.owner);
    }
  });

  it('capabilities are unique', () => {
    const names = firstCapabilityRows.map((r) => r.capability);
    expect(new Set(names).size).toBe(names.length);
  });
});
