#!/usr/bin/env bun
// scripts/distill/preprocess.ts
//
// Read a session's terminal_transcripts, strip ANSI / redraws / dedup,
// emit cleaned plain text to stdout or a file.
//
// Pure local — no network. Read-only on the DB.
//
// Usage:
//   bun scripts/distill/preprocess.ts <session_id>              # print cleaned text
//   bun scripts/distill/preprocess.ts <session_id> --stats      # report reduction
//   bun scripts/distill/preprocess.ts <session_id> --out <path> # write to file

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { writeFileSync } from 'fs';

const DB_PATH = process.env.ANT_DB || join(process.env.HOME || '/tmp', '.ant-v3', 'ant.db');

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('usage: bun preprocess.ts <session_id> [--stats | --out <path>]');
  process.exit(1);
}
const flag = process.argv[3];
const outPath = flag === '--out' ? process.argv[4] : undefined;
const statsOnly = flag === '--stats';

const db = new Database(DB_PATH, { readonly: true });

type Row = { chunk_index: number; raw_data: Buffer; timestamp: string };
const rows = db.prepare(
  'SELECT chunk_index, raw_data, timestamp FROM terminal_transcripts WHERE session_id = ? ORDER BY chunk_index'
).all(sessionId) as Row[];

if (rows.length === 0) {
  console.error(`no transcripts for session ${sessionId}`);
  process.exit(2);
}

// ─── raw bytes → string ───────────────────────────────────────────────────
// bun:sqlite may return BLOB as string OR Uint8Array depending on driver state;
// handle both by normalising to string.
function asStr(v: any): string { return typeof v === 'string' ? v : Buffer.from(v).toString('utf8'); }
let text = rows.map(r => asStr(r.raw_data)).join('');
const rawBytes = Buffer.byteLength(text, 'utf8');
const rawChars = text.length;

// ─── strip common terminal escapes ────────────────────────────────────────
function stripAnsi(s: string): string {
  // CSI sequences: ESC [ params cmd
  s = s.replace(/\x1b\[[\d;?]*[a-zA-Z]/g, '');
  // OSC sequences: ESC ] ... BEL or ESC \
  s = s.replace(/\x1b\][^\x07\x1b]*\x07/g, '');
  s = s.replace(/\x1b\][^\x1b]*\x1b\\/g, '');
  // Charset/cursor codes: ESC = ESC > ESC ( ESC ) etc.
  s = s.replace(/\x1b[=>()\-\/]./g, '');
  // Other single-char ESC sequences
  s = s.replace(/\x1b[DEHMNOZ78c]/g, '');
  return s;
}

text = stripAnsi(text);
const postAnsi = text.length;

// ─── handle \r redraws ────────────────────────────────────────────────────
// When a \r appears without a following \n, prior characters on that line
// were overwritten. Keep only what's after the last \r on each line.
function collapseCarriageReturns(s: string): string {
  return s.split('\n').map(line => {
    if (!line.includes('\r')) return line;
    const parts = line.split('\r');
    // Keep only the final write
    return parts[parts.length - 1];
  }).join('\n');
}

text = collapseCarriageReturns(text);

// ─── strip control chars, tabs normalise ─────────────────────────────────
text = text.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '');

// ─── dedupe adjacent identical lines (spinners, re-renders) ──────────────
function dedupAdjacent(s: string): string {
  const lines = s.split('\n');
  const out: string[] = [];
  let prev: string | null = null;
  let count = 0;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === prev) {
      count++;
    } else {
      if (count > 1) out.push(`  [↺ previous line repeated ${count}×]`);
      out.push(line);
      prev = line;
      count = 1;
    }
  }
  if (count > 1) out.push(`  [↺ previous line repeated ${count}×]`);
  return out.join('\n');
}

text = dedupAdjacent(text);

// ─── strip obvious spinner/progress frames ────────────────────────────────
// Common spinner glyphs, percent ticks, elapsed-time counters
const spinnerRegex = /^[\s]*[⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿|/\-\\◐◓◑◒◴◷◶◵◣◢◥◤▖▘▝▗]\s*/;
text = text.split('\n').filter(l => !(spinnerRegex.test(l) && l.length < 80)).join('\n');

// ─── collapse excess blank runs ───────────────────────────────────────────
text = text.replace(/\n{4,}/g, '\n\n\n');

const cleanChars = text.length;

if (statsOnly) {
  const pct = (n: number, d: number) => (100 * n / d).toFixed(1) + '%';
  console.log(`session:        ${sessionId}`);
  console.log(`chunks:         ${rows.length}`);
  console.log(`first:          ${rows[0].timestamp}`);
  console.log(`last:           ${rows[rows.length-1].timestamp}`);
  console.log(`raw bytes:      ${rawBytes.toLocaleString()}`);
  console.log(`raw chars:      ${rawChars.toLocaleString()}`);
  console.log(`post-ANSI:      ${postAnsi.toLocaleString()}  (${pct(postAnsi, rawChars)} of raw)`);
  console.log(`clean chars:    ${cleanChars.toLocaleString()}  (${pct(cleanChars, rawChars)} of raw)`);
  console.log(`est. tokens:    ~${Math.round(cleanChars / 4).toLocaleString()}`);
  process.exit(0);
}

if (outPath) {
  writeFileSync(outPath, text);
  console.error(`wrote ${cleanChars.toLocaleString()} chars (~${Math.round(cleanChars / 4).toLocaleString()} tokens) to ${outPath}`);
} else {
  process.stdout.write(text);
}
