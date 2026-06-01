/**
 * /sheets/[slug] — read-only spreadsheet viewer (CSV-backed stopgap).
 *
 * Reads `~/CascadeProjects/ANT-Sheets/<slug>.csv` and parses it server-side.
 * Renders inline as a scrollable HTML table — no formulas, no editing,
 * no .xlsx round-trip. Flips to Univer Sheets once codex's #166a engine
 * spike lands.
 *
 * Path-safety follows the same pattern as /d, /docs, /html: anchored
 * slug, resolved path stays under the configured root.
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseCsv } from '$lib/csv/parseCsv';

const SLUG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const SHEETS_ROOT = process.env.ANT_SHEETS_ROOT
  ? resolve(process.env.ANT_SHEETS_ROOT)
  : join(homedir(), 'CascadeProjects', 'ANT-Sheets');

export const load: PageServerLoad = async ({ params }) => {
  if (!SLUG_PATTERN.test(params.slug)) throw error(400, 'Invalid sheet slug.');

  const filePath = resolve(SHEETS_ROOT, `${params.slug}.csv`);
  if (!filePath.startsWith(SHEETS_ROOT + '/') && filePath !== SHEETS_ROOT) {
    throw error(400, 'Path traversal blocked.');
  }

  let raw: string;
  let modifiedAtMs: number | null = null;
  try {
    const [realRoot, realFilePath] = await Promise.all([
      realpath(SHEETS_ROOT),
      realpath(filePath)
    ]);
    if (!realFilePath.startsWith(realRoot + '/') && realFilePath !== realRoot) {
      throw error(400, 'Path traversal blocked.');
    }
    raw = await readFile(realFilePath, 'utf8');
    const info = await stat(realFilePath);
    modifiedAtMs = info.mtimeMs;
  } catch (failure) {
    if (typeof failure === 'object' && failure !== null && 'status' in failure) {
      throw failure;
    }
    throw error(
      404,
      `Sheet "${params.slug}" not found at ${filePath}. Author the CSV file to publish it.`
    );
  }

  const table = parseCsv(raw);
  return {
    slug: params.slug,
    header: table.header,
    rows: table.rows,
    filePath,
    modifiedAtMs,
    rowCount: table.rows.length,
    colCount: table.header.length
  };
};
