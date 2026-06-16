#!/usr/bin/env node
/**
 * firehose-mine-local — mine staged firehose transcripts into lessons using a
 * LOCAL Ollama model (zero Claude budget, no spend/rate/session limits). This is
 * the ANT local-compute path: the Claude Workflow miner kept hitting Claude's
 * limits because it burned Claude tokens; this runs entirely on-device.
 *
 * Reads batch manifests (the s*.json files from `prepare --out`), sends each
 * transcript to Ollama /api/chat with format:json, extracts 0..N durable
 * lessons, and writes survivors to ObsidiANT/memory-pack/_mined/ (dedup by
 * filename). Lessons are tagged source: mined-from-firehose-local so review
 * knows they came from a local model (lower confidence than the Claude pass).
 *
 * Usage:
 *   node scripts/firehose-mine-local.mjs --batches s05,s06,...,s13 [--model gemma4:12b-mlx] [--limit N] [--concurrency 3]
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MINED = join(homedir(), 'CascadeProjects', 'ObsidiANT', 'memory-pack', '_mined');
const OLLAMA = 'http://localhost:11434/api/chat';
const TRANSCRIPT_CAP = 32 * 1024; // fit local context; transcripts are head-most signal

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const MODEL = arg('--model', 'gemma4:12b-mlx');
const LIMIT = parseInt(arg('--limit', '0'), 10) || 0;
const CONC = parseInt(arg('--concurrency', '3'), 10) || 3;
const BATCHES = arg('--batches', 's05,s06,s07,s08,s09,s10,s11,s12,s13').split(',').map((s) => s.trim());

const SYS = `You extract DURABLE, REUSABLE, NON-OBVIOUS engineering lessons from one agent-terminal session transcript.
Respond ONLY with JSON: {"lessons":[{"name":"kebab-slug","description":"one-line recall hook","type":"feedback|gotcha|pattern|reference","scope":"...","rule":"...","why":"...","howToApply":"..."}]}.
QUALITY OVER VOLUME — most sessions yield ZERO. Emit a lesson ONLY for a genuine, reusable, non-obvious learning (a recurring gotcha, a confirmed pattern, durable feedback, or a durable reference fact). Do NOT emit task narration, generic/obvious advice, or session-specific trivia. If nothing qualifies, return {"lessons":[]}.`;

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

async function extract(transcriptPath) {
  let text;
  try { text = readFileSync(transcriptPath, 'utf8'); } catch { return []; }
  if (text.length > TRANSCRIPT_CAP) text = text.slice(0, TRANSCRIPT_CAP) + '\n…[truncated]';
  const res = await fetch(OLLAMA, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      format: 'json',
      stream: false,
      options: { temperature: 0.2 },
      messages: [
        { role: 'system', content: SYS },
        { role: 'user', content: `Transcript:\n\n${text}` }
      ]
    })
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const j = await res.json();
  let parsed;
  try { parsed = JSON.parse(j.message?.content ?? '{}'); } catch { return []; }
  return Array.isArray(parsed?.lessons) ? parsed.lessons : [];
}

function writeLesson(l, existing) {
  if (!l || !l.name || !l.rule) return false;
  const name = slug(l.name);
  if (!name) return false;
  const file = join(MINED, `${name}.md`);
  if (existsSync(file) || existing.has(`${name}.md`)) return false; // dedup by filename
  const fm = [
    '---', `name: ${name}`, `description: ${(l.description || '').replace(/\n/g, ' ')}`,
    `type: ${l.type || 'reference'}`, `scope: ${(l.scope || '').replace(/\n/g, ' ')}`,
    'source: mined-from-firehose-local', `model: ${MODEL}`, 'date: 2026-06-15', '---'
  ].join('\n');
  const body = `# ${name}\n**Rule:** ${l.rule}\n**Why:** ${l.why || ''}\n**How to apply:** ${l.howToApply || ''}\n`;
  writeFileSync(file, `${fm}\n${body}`);
  existing.add(`${name}.md`);
  return true;
}

async function pool(items, worker, size) {
  const results = [];
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i).catch((e) => ({ error: e.message }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

async function main() {
  if (!existsSync(MINED)) mkdirSync(MINED, { recursive: true });
  const existing = new Set(readdirSync(MINED).filter((f) => f.endsWith('.md')));
  // gather transcript entries from the batch manifests
  const seen = new Set();
  let entries = [];
  for (const b of BATCHES) {
    const f = `/tmp/firehose-mining/${b}.json`;
    if (!existsSync(f)) { console.warn(`skip missing ${f}`); continue; }
    for (const e of JSON.parse(readFileSync(f, 'utf8'))) {
      if (e.transcript && !seen.has(e.transcript)) { seen.add(e.transcript); entries.push(e); }
    }
  }
  if (LIMIT) entries = entries.slice(0, LIMIT);
  console.log(`model=${MODEL} concurrency=${CONC} transcripts=${entries.length} (batches: ${BATCHES.join(',')})`);

  let written = 0, done = 0, errors = 0;
  await pool(entries, async (e) => {
    let lessons = [];
    try { lessons = await extract(e.transcript); }
    catch (err) { errors++; done++; if (done % 25 === 0) console.log(`  …${done}/${entries.length} (${written} written, ${errors} err)`); return; }
    for (const l of lessons) if (writeLesson(l, existing)) written++;
    done++;
    if (done % 25 === 0 || done === entries.length) console.log(`  …${done}/${entries.length} (${written} written, ${errors} err)`);
  }, CONC);

  console.log(`\nDONE: ${written} lessons written to _mined (errors: ${errors}). Total _mined now: ${readdirSync(MINED).filter((f) => f.endsWith('.md')).length}`);
}

main();
