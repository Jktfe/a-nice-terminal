import { describe, expect, it } from 'vitest';
import { parseColumnSpec } from './trackerRouteHelpers';

describe('parseColumnSpec', () => {
  it("maps JWPK's typed column spec to labels + types", () => {
    const cols = parseColumnSpec('beneficiary, quantum(£), invoice link(link), due date(date), paid(y/n), date paid(date)');
    expect(cols).toEqual([
      { label: 'beneficiary', type: undefined },
      { label: 'quantum', type: 'currency' },
      { label: 'invoice link', type: 'link' },
      { label: 'due date', type: 'date' },
      { label: 'paid', type: 'bool' },
      { label: 'date paid', type: 'date' }
    ]);
  });
  it('accepts colon type syntax + currency/$/num aliases', () => {
    expect(parseColumnSpec('amount($), n(num), flag(boolean)')).toEqual([
      { label: 'amount', type: 'currency' },
      { label: 'n', type: 'number' },
      { label: 'flag', type: 'bool' }
    ]);
  });
  it('plain columns default to text (undefined type)', () => {
    expect(parseColumnSpec('a, b, c')).toEqual([{label:'a'},{label:'b'},{label:'c'}]);
  });
});
