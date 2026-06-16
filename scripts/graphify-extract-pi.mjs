#!/usr/bin/env node
/**
 * graphify-extract-pi — produce graphify's extraction JSON (.graphify_extract.json)
 * from the kept _mined lessons using pi workers on Ollama cloud models, so the
 * graph extraction stays OFF Claude's budget. graphify's own build/cluster/report
 * steps (pure Python, no LLM) then consume this file.
 *
 * Each lesson becomes a node (id = its slug). The model also emits shared CONCEPT
 * nodes (stable slugs) so lessons that touch the same concept connect across
 * chunks, plus lesson↔lesson related_to edges. Output matches graphify's schema.
 *
 * Usage: node scripts/graphify-extract-pi.mjs --out <path> [--chunk 18] [--workers 8] [--limit N]
 */

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MINED = join(homedir(), 'CascadeProjects', 'ObsidiANT', 'memory-pack', '_mined');
const MODELS = ['minimax-m3:cloud', 'kimi-k2.7-code:cloud'];
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const OUT = arg('--out', join(homedir(), 'CascadeProjects', 'ObsidiANT', 'memory-pack', '.graphify_extract.json'));
const CHUNK = parseInt(arg('--chunk', '18'), 10) || 18;
const WORKERS = parseInt(arg('--workers', '8'), 10) || 8;
const LIMIT = parseInt(arg('--limit', '0'), 10) || 0;

const SYS = `You build a knowledge-graph fragment from a list of engineering "lessons". Output ONLY valid JSON, no prose:
{"nodes":[{"id":"slug","label":"short label","file_type":"document","source_file":"path"}],
 "edges":[{"source":"id","target":"id","relation":"about|related_to","confidence":"EXTRACTED|INFERRED","confidence_score":1.0,"weight":1.0}]}
For EACH lesson: emit one node with id = the lesson's given slug, label = a 2-6 word title, source_file = the lesson's given path.
Also emit shared CONCEPT nodes: id = a lowercase-hyphenated concept slug (e.g. "tmux", "durable-session-auth", "sqlite-schema", "vercel-deploy", "swift-concurrency"), label = the concept, source_file = "".
Edges: each lesson --about--> each concept it concerns (confidence EXTRACTED, score 1.0); and lesson --related_to--> lesson when two lessons clearly address the same problem (confidence INFERRED, score 0.6-0.9).
CRITICAL: reuse the SAME concept slug across lessons so shared concepts merge into one node. Keep concept slugs general and stable. 3-8 concepts per lesson max.`;

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80); }

function runPi(model, chunkFile) {
  return new Promise((resolve) => {
    const c = spawn('pi', ['-p', '--no-tools', '--no-session', '--mode', 'text', '--provider', 'ollama', '--model', model,
      '--append-system-prompt', SYS, `@${chunkFile}`, 'Build the graph fragment. Output ONLY the JSON.'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => resolve(o)); c.on('error', () => resolve(''));
  });
}
function parse(out) { if (!out) return null; const a = out.indexOf('{'), b = out.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(out.slice(a, b + 1)); } catch { return null; } }

async function main() {
  let files = readdirSync(MINED).filter((f) => f.endsWith('.md')); // top-level only — excludes _pruned/_dupes subdirs
  if (LIMIT) files = files.slice(0, LIMIT);
  // build chunks of lesson summaries
  const chunks = [];
  for (let i = 0; i < files.length; i += CHUNK) {
    const lines = [];
    for (const f of files.slice(i, i + CHUNK)) {
      const t = readFileSync(join(MINED, f), 'utf8');
      const name = (t.match(/^name:\s*(.+)$/m) || [])[1] || f.replace(/\.md$/, '');
      const desc = (t.match(/^description:\s*(.+)$/m) || [])[1] || '';
      const rule = (t.match(/\*\*Rule:\*\*\s*(.+)$/m) || [])[1] || '';
      lines.push(`- slug=${name} | path=_mined/${f} | ${desc} | RULE: ${rule}`.slice(0, 600));
    }
    const cf = `/tmp/gfx-chunk-${chunks.length}.txt`;
    writeFileSync(cf, `Lessons:\n${lines.join('\n')}`);
    chunks.push(cf);
  }
  console.log(`lessons=${files.length} chunks=${chunks.length} workers=${WORKERS} (${MODELS.join(' + ')})`);

  const nodes = new Map(); const edges = []; let next = 0, done = 0, errs = 0;
  async function worker(mi) {
    const model = MODELS[mi];
    while (true) {
      const i = next++; if (i >= chunks.length) break;
      const r = parse(await runPi(model, chunks[i]));
      if (!r) { errs++; } else {
        for (const n of (r.nodes || [])) { if (n && n.id) { const id = slug(n.id); if (!nodes.has(id)) nodes.set(id, { id, label: n.label || id, file_type: 'document', source_file: n.source_file || '', source_location: null, source_url: null, captured_at: null, author: null, contributor: null }); } }
        for (const e of (r.edges || [])) { if (e && e.source && e.target) edges.push({ source: slug(e.source), target: slug(e.target), relation: e.relation || 'related_to', confidence: e.confidence || 'INFERRED', confidence_score: e.confidence_score ?? 0.7, source_file: '', source_location: null, weight: e.weight ?? 1.0 }); }
      }
      done++;
      if (done % 10 === 0 || done === chunks.length) console.log(`  …${done}/${chunks.length} chunks  nodes=${nodes.size} edges=${edges.length} err=${errs}`);
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k < WORKERS / 2 ? 0 : 1)));

  // keep only edges whose endpoints exist as nodes
  const valid = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target));
  const extract = { nodes: [...nodes.values()], edges: valid, hyperedges: [], input_tokens: 0, output_tokens: 0 };
  writeFileSync(OUT, JSON.stringify(extract, null, 2));
  console.log(`\nDONE: ${extract.nodes.length} nodes, ${valid.length} edges (dropped ${edges.length - valid.length} dangling) → ${OUT}  [chunk errors: ${errs}]`);
}
main();
