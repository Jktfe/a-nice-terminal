#!/usr/bin/env node
/**
 * firehose-verify-pi — adversarial verify+prune of the pi-tier mined lessons,
 * using pi workers on Ollama cloud models (off Claude's budget). The pi extract
 * pass had no verify gate and over-produced; this strict pass keeps only the
 * durable/reusable/non-obvious lessons and moves the rest to _mined/_pruned/.
 *
 * Only touches lessons tagged `source: mined-from-firehose-pi`. Claude-verified
 * lessons (no that tag) are left alone. Nothing is deleted — rejects are moved.
 *
 * Usage: node scripts/firehose-verify-pi.mjs [--workers 8] [--limit N]
 */

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MINED = join(homedir(), 'CascadeProjects', 'ObsidiANT', 'memory-pack', '_mined');
const PRUNED = join(MINED, '_pruned');
const MODELS = ['minimax-m3:cloud', 'kimi-k2.7-code:cloud'];

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const WORKERS = parseInt(arg('--workers', '8'), 10) || 8;
const LIMIT = parseInt(arg('--limit', '0'), 10) || 0;

const SYS = `You are a STRICT reviewer of a mined engineering "lesson". Output ONLY valid JSON, no prose: {"keep":true|false,"reason":"short"}.
KEEP only if the lesson is ALL of: (a) durable — true beyond a single session; (b) reusable — a future agent would actually apply it; (c) non-obvious — not generic/common engineering knowledge; (d) specific and actionable.
DROP if it is task narration, a one-off, vague, generic/obvious advice, restates a basic concept, or is too session-specific to reuse. Default to {"keep":false} when uncertain. Be harsh — most should be dropped.`;

function runPi(model, lessonPath) {
  return new Promise((resolve) => {
    const child = spawn('pi', [
      '-p', '--no-tools', '--no-session', '--mode', 'text',
      '--provider', 'ollama', '--model', model,
      '--append-system-prompt', SYS,
      `@${lessonPath}`,
      'Judge this lesson. Output ONLY the JSON {"keep":...,"reason":...}.'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('close', () => resolve(out));
    child.on('error', () => resolve(''));
  });
}

function verdict(out) {
  if (!out) return null;
  const a = out.indexOf('{'), b = out.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(out.slice(a, b + 1)); } catch { return null; }
}

async function main() {
  if (!existsSync(PRUNED)) mkdirSync(PRUNED, { recursive: true });
  let queue = readdirSync(MINED)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => /mined-from-firehose-pi/.test(readFileSync(join(MINED, f), 'utf8')));
  if (LIMIT) queue = queue.slice(0, LIMIT);
  const total = queue.length;
  console.log(`verify+prune: ${total} pi-tier lessons | workers=${WORKERS} (${MODELS.join(' + ')})`);

  let next = 0, done = 0, kept = 0, pruned = 0, errs = 0;
  async function worker(modelIdx) {
    const model = MODELS[modelIdx];
    while (true) {
      const i = next++;
      if (i >= total) break;
      const f = queue[i];
      const v = verdict(await runPi(model, join(MINED, f)));
      if (v == null) { errs++; kept++; } // keep on verifier failure (don't lose on error)
      else if (v.keep === false) { try { renameSync(join(MINED, f), join(PRUNED, f)); pruned++; } catch { kept++; } }
      else kept++;
      done++;
      if (done % 50 === 0 || done === total) console.log(`  …${done}/${total}  kept=${kept}  pruned=${pruned}  err=${errs}`);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k < WORKERS / 2 ? 0 : 1)));

  const remaining = readdirSync(MINED).filter((f) => f.endsWith('.md'));
  let claude = 0; for (const f of remaining) if (!/mined-from-firehose-pi/.test(readFileSync(join(MINED, f), 'utf8'))) claude++;
  console.log(`\nDONE: kept ${kept}, pruned ${pruned} (→ _pruned/), verifier errors ${errs}.`);
  console.log(`_mined now: ${remaining.length} (claude-verified ${claude} + pi-kept ${remaining.length - claude}) | _pruned: ${readdirSync(PRUNED).filter((f) => f.endsWith('.md')).length}`);
}
main();
