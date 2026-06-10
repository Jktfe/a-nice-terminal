import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TrackerTable from './TrackerTable.svelte';
import type { TrackerView } from '$lib/server/trackerStore';

const VIEW: TrackerView = {
  id: 'trk_1', roomId: 'r1', title: 'GVPL4 payments', createdByHandle: '@you', createdAtMs: 1,
  columns: [
    { key: 'beneficiary', label: 'Beneficiary', type: 'text' },
    { key: 'quantum', label: 'Quantum', type: 'currency' },
    { key: 'paid', label: 'Paid', type: 'bool' }
  ],
  rows: [
    { id: 'row_1', tableId: 'trk_1', cells: { beneficiary: 'Acme Ltd', quantum: '12500', paid: 'true' }, createdByHandle: '@a', createdAtMs: 2, updatedAtMs: 3 }
  ],
  events: [
    { seq: 1, tableId: 'trk_1', rowId: 'row_1', kind: 'row.add', columnKey: null, oldValue: null, newValue: '{}', byHandle: '@a', atMs: 2 },
    { seq: 2, tableId: 'trk_1', rowId: 'row_1', kind: 'cell.set', columnKey: 'paid', oldValue: '', newValue: 'true', byHandle: '@b', atMs: 3 }
  ]
};

describe('TrackerTable', () => {
  it('renders the title + every column header + the row data', () => {
    const { body } = render(TrackerTable, { props: { trackerId: 'trk_1', roomId: 'r1', initialTracker: VIEW } });
    expect(body).toContain('GVPL4 payments');
    expect(body).toContain('Beneficiary');
    expect(body).toContain('Quantum');
    expect(body).toContain('Paid');
    expect(body).toContain('Acme Ltd');
  });

  it('renders a bool cell as a ✓ toggle and exposes an add-row + history affordance', () => {
    const { body } = render(TrackerTable, { props: { trackerId: 'trk_1', roomId: 'r1', initialTracker: VIEW } });
    expect(body).toContain('✓');
    expect(body).toContain('+ row');
    expect(body).toContain('history');
    expect(body).toContain('1 rows · 1 edits');
  });

  it('renders nothing before data (pre-fetch)', () => {
    const { body } = render(TrackerTable, { props: { trackerId: 'trk_1', roomId: 'r1' } });
    expect(body).not.toContain('class="tracker"');
  });
});
