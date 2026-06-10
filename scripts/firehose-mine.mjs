/**
 * firehose-mine — the mechanical half of the mining pass. Run via `bunx tsx`
 * (NOT bare bun — bun can't load better-sqlite3; tsx runs under node + esbuild
 * so it resolves the extensionless TS imports AND the native better-sqlite3
 * binding, the same combo vitest uses). Needs the v22 node toolchain on PATH.
 * The LLM extraction + graphify steps are driven by the /mine-firehose skill,
 * which calls this for select+reconstruct (`prepare`) and the watermark (`mark`).
 *
 *   bunx tsx scripts/firehose-mine.mjs prepare --dry-run        # scope + cost, no writes, no LLM
 *   bunx tsx scripts/firehose-mine.mjs prepare --out <dir>      # stage transcripts + manifest.json
 *   bunx tsx scripts/firehose-mine.mjs mark --manifest <path>   # mark those sessions mined (after extraction)
 *
 * Reads the telemetry sidecar (getTelemetryDb). If the sidecar isn't on +
 * backfilled yet, the firehose is empty here → 0 candidates (expected). Never
 * deletes firehose rows.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectHighSignalSessions } from '../src/lib/server/firehoseSelector.ts';
import { reconstructSession } from '../src/lib/server/sessionReconstruct.ts';
import { firehoseMiningDryRun } from '../src/lib/server/firehoseMiningDryRun.ts';
import { markSessionMined } from '../src/lib/server/firehoseMiningState.ts';

const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (name) => argv.includes(name);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const num = (v) => (v === undefined ? undefined : Number(v));

const opts = {};
for (const [k, v] of [
  ['minEvents', num(flag('--min-events'))],
  ['minSpanMs', num(flag('--min-span-ms'))],
  ['gapMs', num(flag('--gap-ms'))],
  ['maxBytes', num(flag('--max-bytes'))]
]) {
  if (v !== undefined && Number.isFinite(v)) opts[k] = v;
}

if (cmd === 'prepare' && has('--dry-run')) {
  console.log(JSON.stringify(firehoseMiningDryRun(opts), null, 2));
  process.exit(0);
}

if (cmd === 'prepare') {
  const outDir = flag('--out', '/tmp/firehose-mining');
  mkdirSync(outDir, { recursive: true });
  const candidates = selectHighSignalSessions(opts);
  const manifest = [];
  for (const c of candidates) {
    const r = reconstructSession(c.window, opts.maxBytes ? { maxBytes: opts.maxBytes } : undefined);
    const key = `${c.window.terminalId}__${c.window.windowStartMs}-${c.window.windowEndMs}`;
    const file = join(outDir, `${key.replace(/[^a-zA-Z0-9_.-]/g, '_')}.md`);
    writeFileSync(file, r.transcript, 'utf8');
    manifest.push({
      terminalId: c.window.terminalId,
      windowStartMs: c.window.windowStartMs,
      windowEndMs: c.window.windowEndMs,
      signals: c.signals,
      transcript: file,
      bytes: r.bytes
    });
  }
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[mine] staged ${manifest.length} transcript(s) → ${outDir}`);
  console.log(`[mine] manifest: ${manifestPath}`);
  process.exit(0);
}

if (cmd === 'mark') {
  const manifestPath = flag('--manifest');
  if (!manifestPath) {
    console.error('mark requires --manifest <path>');
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let n = 0;
  for (const m of manifest) {
    markSessionMined({
      terminalId: m.terminalId,
      windowStartMs: m.windowStartMs,
      windowEndMs: m.windowEndMs
    });
    n += 1;
  }
  console.log(`[mine] marked ${n} session(s) mined — watermark advanced`);
  process.exit(0);
}

console.error('usage:');
console.error('  bun scripts/firehose-mine.mjs prepare --dry-run');
console.error('  bun scripts/firehose-mine.mjs prepare [--out DIR] [--min-events N] [--min-span-ms M] [--gap-ms G] [--max-bytes B]');
console.error('  bun scripts/firehose-mine.mjs mark --manifest <path>');
process.exit(1);
