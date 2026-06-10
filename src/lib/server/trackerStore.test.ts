import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  createTracker, addRow, setCell, getTrackerView, listTrackersForRoom, columnKeyForLabel
} from './trackerStore';

let tmp: string; const prev = process.env.ANT_FRESH_DB_PATH;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(),'ant-trk-')); process.env.ANT_FRESH_DB_PATH = join(tmp,'t.db'); resetIdentityDbForTests(); });
afterEach(() => { resetIdentityDbForTests(); rmSync(tmp,{recursive:true,force:true}); if (prev===undefined) delete process.env.ANT_FRESH_DB_PATH; else process.env.ANT_FRESH_DB_PATH=prev; });

function seed() {
  return createTracker({ roomId:'r1', title:'GVPL4 payments', createdByHandle:'@you',
    columns:[{label:'Beneficiary'},{label:'Quantum',type:'currency'},{label:'Invoice link',type:'link'},{label:'Due date',type:'date'},{label:'Paid',type:'bool'},{label:'Date paid',type:'date'}] });
}

describe('trackerStore', () => {
  it('createTracker normalises columns to unique keys + types', () => {
    const t = seed();
    expect(t.columns.map(c=>c.key)).toEqual(['beneficiary','quantum','invoice-link','due-date','paid','date-paid']);
    expect(t.columns[1].type).toBe('currency');
    expect(columnKeyForLabel('Date Paid!')).toBe('date-paid');
  });

  it('addRow keeps only known columns + writes a row.add audit event', () => {
    const t = seed();
    const row = addRow({ tableId:t.id, byHandle:'@a', cells:{ beneficiary:'Acme Ltd', quantum:'12500', bogus:'x' } });
    expect(row).not.toBeNull();
    expect(row!.cells.beneficiary).toBe('Acme Ltd');
    expect('bogus' in row!.cells).toBe(false);
    const v = getTrackerView(t.id)!;
    expect(v.rows).toHaveLength(1);
    expect(v.events.filter(e=>e.kind==='row.add')).toHaveLength(1);
  });

  it('setCell records old→new audit, no-ops when unchanged, rejects unknown col/row', () => {
    const t = seed();
    const row = addRow({ tableId:t.id, byHandle:'@a', cells:{ paid:'' } })!;
    const upd = setCell({ tableId:t.id, rowId:row.id, columnKey:'paid', value:'true', byHandle:'@b' })!;
    expect(upd.cells.paid).toBe('true');
    const v = getTrackerView(t.id)!;
    const setEvts = v.events.filter(e=>e.kind==='cell.set');
    expect(setEvts).toHaveLength(1);
    expect(setEvts[0]).toMatchObject({ columnKey:'paid', oldValue:'', newValue:'true', byHandle:'@b' });
    // unchanged → no new event
    setCell({ tableId:t.id, rowId:row.id, columnKey:'paid', value:'true', byHandle:'@c' });
    expect(getTrackerView(t.id)!.events.filter(e=>e.kind==='cell.set')).toHaveLength(1);
    // unknown column / row → null
    expect(setCell({ tableId:t.id, rowId:row.id, columnKey:'nope', value:'x', byHandle:'@b' })).toBeNull();
    expect(setCell({ tableId:t.id, rowId:'row_missing', columnKey:'paid', value:'x', byHandle:'@b' })).toBeNull();
  });

  it('addRow/setCell on a missing table return null', () => {
    expect(addRow({ tableId:'trk_missing', byHandle:'@a', cells:{} })).toBeNull();
  });

  it('listTrackersForRoom returns newest first', () => {
    const a = createTracker({ roomId:'r9', title:'A', createdByHandle:'@you', columns:[{label:'x'}] }, 1000);
    const b = createTracker({ roomId:'r9', title:'B', createdByHandle:'@you', columns:[{label:'x'}] }, 2000);
    expect(listTrackersForRoom('r9').map(t=>t.id)).toEqual([b.id, a.id]);
  });
});
