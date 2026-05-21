/**
 * Minimal CSV parser for the /sheets/<slug> read-only viewer.
 *
 * Handles the common cases — quoted fields with embedded commas,
 * escaped double-quotes via `""`, CRLF + LF line endings — without
 * pulling in a full library. Multi-line cells (`\n` inside quotes)
 * are supported. Strict RFC 4180 isn't a goal; this is enough to
 * read CSVs the team is realistically going to drop into the viewer.
 */

export type CsvTable = {
  header: string[];
  rows: string[][];
};

export function parseCsv(raw: string): CsvTable {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          // Escaped quote
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // Treat CR or CRLF as a row terminator. Skip LF if it follows.
      row.push(field);
      records.push(row);
      field = '';
      row = [];
      i += raw[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      records.push(row);
      field = '';
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Flush the trailing field/row unless the file ended exactly on a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  if (records.length === 0) return { header: [], rows: [] };
  const header = records[0];
  const rows = records.slice(1).filter((r) => r.length > 1 || (r.length === 1 && r[0].length > 0));
  return { header, rows };
}
