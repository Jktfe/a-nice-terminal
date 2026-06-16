#!/usr/bin/env node
/**
 * firehose-mine-pi — mine staged firehose transcripts using a pool of `pi`
 * workers driving Ollama CLOUD models (minimax-m3:cloud + kimi-k2.7-code:cloud).
 * Entirely off Claude's budget — this is the ANT colony lane (pi + cloud models),
 * fast, and immune to Claude spend/session/rate limits.
 *
 * 8 workers by default: the first half use minimax-m3:cloud, the second half
 * kimi-k2.7-code:cloud. Each worker spawns `pi -p` per transcript (ephemeral,
 * no tools), parses the JSON lessons, and writes survivors to _mined (dedup by
 * filename). Lessons are tagged with their producing model.
 *
 * Usage:
 *   node scripts/firehose-mine-pi.mjs --batches s05,...,s13 [--workers 8] [--limit N]
 */

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MINED = join(homedir(), 'CascadeProjects', 'ObsidiANT', 'memory-pack', '_mined');
const MODELS = ['minimax-m3:cloud', 'kimi-k2.7-code:cloud'];

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const WORKERS = parseInt(arg('--workers', '8'), 10) || 8;
const LIMIT = parseInt(arg('--limit', '0'), 10) || 0;
const BATCHES = arg('--batches', 's05,s06,s07,s08,s09,s10,s11,s12,s13').split(',').map((s) => s.trim());

const SYS = `You extract DURABLE, REUSABLE, NON-OBVIOUS engineering lessons from one agent-terminal session transcript.
Output ONLY valid JSON, no prose, no markdown fences: {"lessons":[{"name":"kebab-slug","description":"one-line recall hook","type":"feedback|gotcha|pattern|reference","scope":"...","rule":"...","why":"...","howToApply":"..."}]}.
QUALITY OVER VOLUME — most sessions yield ZERO. Emit a lesson ONLY for a genuine, reusable, non-obvious learning (a recurring gotcha, a confirmed pattern, durable feedback, or a durable reference fact). Do NOT emit task narration, generic/obvious advice, or session-specific trivia. If nothing qualifies, return {"lessons":[]}.`;

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function runPi(model, transcriptPath) {
  return new Promise((resolve) => {
    const child = spawn('pi', [
      '-p', '--no-tools', '--no-session', '--mode', 'text',
      '--provider', 'ollama', '--model', model,
      '--append-system-prompt', SYS,
      `@${transcriptPath}`,
      'Extract durable lessons from this transcript as the JSON object specified. Output ONLY the JSON.'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => resolve(out));
    child.on('error', () => resolve(''));
  });
}

function parseLessons(out) {
  if (!out) return [];
  // grab the largest {...} block (model may wrap with whitespace)
  const a = out.indexOf('{');
  const b = out.lastIndexOf('}');
  if (a < 0 || b <= a) return [];
  try {
    const j = JSON.parse(out.slice(a, b + 1));
    return Array.isArray(j?.lessons) ? j.lessons : [];
  } catch { return []; }
}

function writeLesson(l, model, existing) {
  if (!l || !l.name || !l.rule) return false;
  const name = slug(l.name);
  if (!name) return false;
  const file = join(MINED, `${name}.md`);
  if (existsSync(file) || existing.has(`${name}.md`)) return false;
  const fm = [
    '---', `name: ${name}`, `description: ${(l.description || '').replace(/\n/g, ' ')}`,
    `type: ${l.type || 'reference'}`, `scope: ${(l.scope || '').replace(/\n/g, ' ')}`,
    'source: mined-from-firehose-pi', `model: ${model}`, 'date: 2026-06-15', '---'
  ].join('\n');
  writeFileSync(file, `${fm}\n# ${name}\n**Rule:** ${l.rule}\n**Why:** ${l.why || ''}\n**How to apply:** ${l.howToApply || ''}\n`);
  existing.add(`${name}.md`);
  return true;
}

async function main() {
  if (!existsSync(MINED)) mkdirSync(MINED, { recursive: true });
  const existing = new Set(readdirSync(MINED).filter((f) => f.endsWith('.md')));
  const seen = new Set();
  let queue = [];
  for (const b of BATCHES) {
    const f = `/tmp/firehose-mining/${b}.json`;
    if (!existsSync(f)) { console.warn(`skip missing ${f}`); continue; }
    for (const e of JSON.parse(readFileSync(f, 'utf8'))) {
      if (e.transcript && !seen.has(e.transcript)) { seen.add(e.transcript); queue.push(e.transcript); }
    }
  }
  if (LIMIT) queue = queue.slice(0, LIMIT);
  const total = queue.length;
  console.log(`workers=${WORKERS} (${MODELS.join(' + ')}) transcripts=${total} batches=${BATCHES.join(',')}`);

  let next = 0, done = 0, written = 0, errs = 0;
  const stats = {};
  for (const m of MODELS) stats[m] = 0;

  async function worker(modelIdx) {
    const model = MODELS[modelIdx]; // first half of workers → minimax, second half → kimi
    while (true) {
      const i = next++;
      if (i >= total) break;
      const out = await runPi(model, queue[i]);
      const lessons = parseLessons(out);
      if (!out) errs++;
      for (const l of lessons) if (writeLesson(l, model, existing)) { written++; stats[model]++; }
      done++;
      if (done % 20 === 0 || done === total) console.log(`  …${done}/${total}  written=${written}  err=${errs}  [minimax=${stats[MODELS[0]]} kimi=${stats[MODELS[1]]}]`);
    }
  }
  // assign first half of workers to model 0 (minimax), second half to model 1 (kimi)
  const tasks = Array.from({ length: WORKERS }, (_, k) => worker(k < WORKERS / 2 ? 0 : 1));
  await Promise.all(tasks);
  console.log(`\nDONE: ${written} lessons written (errors ${errs}). minimax=${stats[MODELS[0]]} kimi=${stats[MODELS[1]]}. Total _mined: ${readdirSync(MINED).filter((f) => f.endsWith('.md')).length}`);
}
main();
