import { describe, expect, it } from 'vitest';
import { parseCsv } from './parseCsv';

describe('parseCsv', () => {
  it('handles header + plain rows', () => {
    const result = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(result.header).toEqual(['a', 'b', 'c']);
    expect(result.rows).toEqual([['1', '2', '3'], ['4', '5', '6']]);
  });

  it('strips quotes around fields and keeps embedded commas', () => {
    const result = parseCsv('a,b\n"hello, world",2');
    expect(result.rows).toEqual([['hello, world', '2']]);
  });

  it('handles escaped quotes via double-double-quote', () => {
    const result = parseCsv('a\n"she said ""hi"""');
    expect(result.rows).toEqual([['she said "hi"']]);
  });

  it('treats CRLF and LF as equivalent row terminators', () => {
    const result = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(result.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('drops trailing blank lines', () => {
    const result = parseCsv('a,b\n1,2\n\n');
    expect(result.rows).toEqual([['1', '2']]);
  });

  it('preserves newlines inside quoted fields', () => {
    const result = parseCsv('a\n"line one\nline two"');
    expect(result.rows).toEqual([['line one\nline two']]);
  });

  it('returns empty header + rows for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] });
  });

  it('handles a single header-only file', () => {
    const result = parseCsv('only,header');
    expect(result.header).toEqual(['only', 'header']);
    expect(result.rows).toEqual([]);
  });
});
