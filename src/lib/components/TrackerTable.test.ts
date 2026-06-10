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

  it('SECURITY: a javascript: link cell never renders as an href (XSS block)', () => {
    const evil: TrackerView = {
      ...VIEW,
      columns: [{ key: 'invoice', label: 'Invoice', type: 'link' }],
      rows: [{ id: 'row_e', tableId: 'trk_1', cells: { invoice: 'javascript:alert(1)' }, createdByHandle: '@a', createdAtMs: 2, updatedAtMs: 2 }]
    };
    const { body } = render(TrackerTable, { props: { trackerId: 'trk_1', roomId: 'r1', initialTracker: evil } });
    // The security guarantee: the unsafe value never becomes an href, and is
    // never wrapped in an anchor. Showing it as ESCAPED text is safe + honest.
    expect(body).not.toContain('href="javascript:');
    expect(body).not.toContain('<a class="tk-link"');
    expect(body).toContain('tk-celltext'); // rendered as plain text instead
  });

  it('a safe https link cell DOES render as an href', () => {
    const ok: TrackerView = {
      ...VIEW,
      columns: [{ key: 'invoice', label: 'Invoice', type: 'link' }],
      rows: [{ id: 'row_ok', tableId: 'trk_1', cells: { invoice: 'https://pay.example/inv/1' }, createdByHandle: '@a', createdAtMs: 2, updatedAtMs: 2 }]
    };
    const { body } = render(TrackerTable, { props: { trackerId: 'trk_1', roomId: 'r1', initialTracker: ok } });
    expect(body).toContain('href="https://pay.example/inv/1"');
  });
});