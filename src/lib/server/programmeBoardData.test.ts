import { describe, expect, it } from 'vitest';
import {
  PROGRAMME_BOARD_SNAPSHOT,
  STRICT_STATUS_LABELS,
  LOCKED_SCOPE_SENTENCE,
  LAST_UPDATED_ISO
} from './programmeBoardData';

const allowedInFlightStatuses = new Set(['Review-Ready', 'Review-Held', 'Claim-Ready']);

const allowedMatrixCells = new Set(['Accepted', 'Review-Held', 'Not started', 'Out of scope', '—']);

describe('programmeBoardData', () => {
  it('exports a locked scope sentence that is non-blank', () => {
    expect(LOCKED_SCOPE_SENTENCE.trim().length).toBeGreaterThan(0);
    expect(PROGRAMME_BOARD_SNAPSHOT.lockedScopeSentence).toBe(LOCKED_SCOPE_SENTENCE);
  });

  it('declares a last-updated date', () => {
    expect(LAST_UPDATED_ISO).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(PROGRAMME_BOARD_SNAPSHOT.lastUpdatedIso).toBe(LAST_UPDATED_ISO);
  });

  it('uses only the strict status label set for in-flight rows', () => {
    for (const row of PROGRAMME_BOARD_SNAPSHOT.inFlightSlices) {
      expect(allowedInFlightStatuses.has(row.status)).toBe(true);
      expect(STRICT_STATUS_LABELS).toContain(row.status);
    }
  });

  it('never leaves critical fields blank in any baseline row', () => {
    for (const row of PROGRAMME_BOARD_SNAPSHOT.acceptedBaselines) {
      expect(row.lane.trim().length).toBeGreaterThan(0);
      expect(row.slice.trim().length).toBeGreaterThan(0);
      expect(row.owner.trim().length).toBeGreaterThan(0);
    }
    for (const row of PROGRAMME_BOARD_SNAPSHOT.inFlightSlices) {
      expect(row.lane.trim().length).toBeGreaterThan(0);
      expect(row.slice.trim().length).toBeGreaterThan(0);
      expect(row.owner.trim().length).toBeGreaterThan(0);
    }
    for (const row of PROGRAMME_BOARD_SNAPSHOT.deferred) {
      expect(row.lane.trim().length).toBeGreaterThan(0);
      expect(row.reason.trim().length).toBeGreaterThan(0);
      expect(row.futureTag.trim().length).toBeGreaterThan(0);
    }
    for (const row of PROGRAMME_BOARD_SNAPSHOT.outOfScope) {
      expect(row.lane.trim().length).toBeGreaterThan(0);
      expect(row.directive.trim().length).toBeGreaterThan(0);
      expect(row.dateIso.trim().length).toBeGreaterThan(0);
    }
  });

  it('uses only allowed lane-matrix cell labels', () => {
    for (const row of PROGRAMME_BOARD_SNAPSHOT.laneMatrix) {
      for (const cell of row.cells) {
        expect(allowedMatrixCells.has(cell)).toBe(true);
      }
    }
  });

  it('every owner referenced in baseline/in-flight rows appears in the owner reference table (or is a clearly-shared marker)', () => {
    const knownOwners = new Set(PROGRAMME_BOARD_SNAPSHOT.owners.map((entry) => entry.agent));
    knownOwners.add('split');
    for (const row of PROGRAMME_BOARD_SNAPSHOT.acceptedBaselines) {
      expect(knownOwners.has(row.owner)).toBe(true);
    }
    for (const row of PROGRAMME_BOARD_SNAPSHOT.inFlightSlices) {
      expect(knownOwners.has(row.owner)).toBe(true);
    }
  });

  it('includes the Router-revert / M28 out-of-scope record so the board never silently drops the directive', () => {
    const hasRouterRevert = PROGRAMME_BOARD_SNAPSHOT.outOfScope.some((row) =>
      row.lane.toLowerCase().includes('routing')
    );
    expect(hasRouterRevert).toBe(true);
  });
});
