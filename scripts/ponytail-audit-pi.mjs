#!/usr/bin/env node
/**
 * ponytail-audit-pi — run the ponytail "lazy senior dev" over-engineering audit
 * (DietrichGebert/ponytail) across the codebase using pi workers on Ollama cloud
 * models. Off Claude's budget. READ-ONLY: lists findings, applies nothing.
 *
 * ponytail audit = over-engineering ONLY (not correctness/security/perf). Tags:
 *   delete (dead/speculative) · stdlib (reinvented) · native (platform does it)
 *   · yagni (one-impl abstraction) · shrink (same logic, fewer lines).
 *
 * Usage: node scripts/ponytail-audit-pi.mjs --files <listfile> [--out <report>] [--workers 8]
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const MODELS = ['minimax-m3:cloud', 'kimi-k2.7-code:cloud'];
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const LISTFILE = arg('--files', '/tmp/ponytail-files.txt');
const OUT = arg('--out', '/tmp/ponytail-audit-report.md');
const WORKERS = parseInt(arg('--workers', '8'), 10) || 8;
const MAX_FILE_LINES = 500;   // cap giant files in the bundle
const MAX_CHUNK_BYTES = 40 * 1024;

const SYS = `You are ponytail, a lazy-senior-dev auditor. Audit the given source files for OVER-ENGINEERING ONLY — not correctness, security, or performance.
Output ONLY finding lines, one per line, ranked biggest cut first, in this exact format:
<tag> <what to cut>. <replacement>. [path]
Tags: delete (dead code / speculative feature / unused flexibility), stdlib (hand-rolled thing the standard library ships — name it), native (dependency or code doing what the platform already does — name it), yagni (abstraction with one implementation, config nobody sets, layer with one caller), shrink (same logic, fewer lines — show the shorter form).
Hunt: deps the stdlib/platform already ships, single-implementation interfaces, factories with one product, wrappers that only delegate, files exporting one thing, dead flags/config, hand-rolled stdlib.
Be concrete and cite the [path]. Output NOTHING if these files are already lean. No preamble, no markdown headers, no summary.`;

function bundle(files) {
  let buf = '', used = [];
  for (const f of files) {
    let body;
    try { body = readFileSync(f, 'utf8'); } catch { continue; }
    const lines = body.split('\n');
    if (lines.length > MAX_FILE_LINES) body = lines.slice(0, MAX_FILE_LINES).join('\n') + `\n…[truncated ${lines.length - MAX_FILE_LINES} lines]`;
    const block = `\n===== FILE: ${f} =====\n${body}\n`;
    if (buf.length + block.length > MAX_CHUNK_BYTES && used.length) break;
    buf += block; used.push(f);
  }
  return { text: buf, used };
}

function runPi(model, chunkFile) {
  return new Promise((resolve) => {
    const c = spawn('pi', ['-p', '--no-tools', '--no-session', '--mode', 'text', '--provider', 'ollama', '--model', model,
      '--append-system-prompt', SYS, `@${chunkFile}`, 'Audit these files for over-engineering. Output ONLY the finding lines.'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => resolve(o)); c.on('error', () => resolve(''));
  });
}

async function main() {
  const all = readFileSync(LISTFILE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  // build chunks (~6 files or 40KB)
  const chunks = []; let rest = all.slice();
  while (rest.length) {
    const { used } = bundle(rest.slice(0, 8));
    const take = used.length || 1;
    const { text } = bundle(rest.slice(0, take));
    const cf = `/tmp/pa-chunk-${chunks.length}.txt`;
    writeFileSync(cf, text);
    chunks.push(cf);
    rest = rest.slice(take);
  }
  console.log(`files=${all.length} chunks=${chunks.length} workers=${WORKERS} (${MODELS.join(' + ')})`);

  const findings = []; let next = 0, done = 0, errs = 0;
  async function worker(mi) {
    const model = MODELS[mi];
    while (true) {
      const i = next++; if (i >= chunks.length) break;
      const out = await runPi(model, chunks[i]);
      if (!out) errs++;
      for (const line of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
        if (/^(delete|stdlib|native|yagni|shrink)\b/i.test(line)) findings.push(line);
      }
      done++;
      if (done % 10 === 0 || done === chunks.length) console.log(`  …${done}/${chunks.length} chunks  findings=${findings.length}  err=${errs}`);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k < WORKERS / 2 ? 0 : 1)));

  // group by tag
  const byTag = {};
  for (const f of findings) { const t = f.split(/\s/)[0].toLowerCase().replace(/[:.].*$/, ''); (byTag[t] ||= []).push(f); }
  let md = `# Ponytail over-engineering audit (pi/cloud)\n\nFiles audited: ${all.length} | findings: ${findings.length} | chunk errors: ${errs}\n`;
  for (const tag of ['delete', 'yagni', 'stdlib', 'native', 'shrink']) {
    const fs = byTag[tag] || [];
    md += `\n## ${tag} (${fs.length})\n` + fs.map((l) => `- ${l}`).join('\n') + '\n';
  }
  writeFileSync(OUT, md);
  console.log(`\nDONE: ${findings.length} findings → ${OUT}`);
  for (const tag of ['delete', 'yagni', 'stdlib', 'native', 'shrink']) console.log(`  ${tag}: ${(byTag[tag] || []).length}`);
}
main();
