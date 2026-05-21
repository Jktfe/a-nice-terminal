#!/usr/bin/env node
// check-cli-docs-alignment — m5.5 CLI docs generation proof.
// Asserts /discover.md (rendered) is in lockstep with src/lib/cli-manifest/
// manifest.ts (canonical). Catches both drift directions: a verb in source
// that fails to render, and a rendered verb that no longer exists in source.
// Also resolves every Source: line to a real file on disk.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const URL_BASE = process.env.ANT_FRESH_URL ?? 'http://127.0.0.1:6174';
const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const MANIFEST_PATH = join(REPO_ROOT, 'src/lib/cli-manifest/manifest.ts');

function manifestVerbIds() {
  const src = readFileSync(MANIFEST_PATH, 'utf8');
  const ids = new Set();
  // Factory call pattern: av('id', ...) / pl('id', ...) / nw('id', ...)
  for (const match of src.matchAll(/(?:^|\s)(?:av|pl|nw)\(\s*'([^']+)'/g)) ids.add(match[1]);
  // Object-literal pattern for cross-repo entries (e.g. v3 wrappers): { id: 'x', ... }
  for (const match of src.matchAll(/\{\s*id:\s*'([^']+)'/g)) ids.add(match[1]);
  return ids;
}

function manifestSourceRefs() {
  const src = readFileSync(MANIFEST_PATH, 'utf8');
  const refs = [];
  for (const m of src.matchAll(/['"`]([\w/.[\]-]+\.(?:ts|mjs|svelte|md)):(\d+(?:[,-]\d+)*)['"`]/g)) {
    refs.push(m[1]);
  }
  return [...new Set(refs)];
}

async function fetchDocsMd() {
  const res = await fetch(`${URL_BASE}/discover.md`);
  if (!res.ok) throw new Error(`/discover.md HTTP ${res.status}`);
  return res.text();
}

function renderedVerbIds(markdown) {
  const ids = new Set();
  for (const m of markdown.matchAll(/<a id="verb-([\w-]+)">/g)) ids.add(m[1]);
  return ids;
}

function symmetricDiff(setA, setB) {
  const onlyA = [...setA].filter((x) => !setB.has(x));
  const onlyB = [...setB].filter((x) => !setA.has(x));
  return { onlyA, onlyB };
}

export async function runAlignmentCheck({ writeOut = console.log } = {}) {
  writeOut(`probe target: ${URL_BASE}/discover.md vs ${MANIFEST_PATH}`);
  const sourceIds = manifestVerbIds();
  const md = await fetchDocsMd();
  const renderedIds = renderedVerbIds(md);
  writeOut(`source ids: ${sourceIds.size}, rendered ids: ${renderedIds.size}`);
  const { onlyA: missingFromRender, onlyB: extraInRender } = symmetricDiff(sourceIds, renderedIds);
  if (missingFromRender.length > 0) throw new Error(`source ids not rendered: ${missingFromRender.join(', ')}`);
  if (extraInRender.length > 0) throw new Error(`rendered ids not in source: ${extraInRender.join(', ')}`);
  const refs = manifestSourceRefs();
  const missingRefs = [];
  for (const ref of refs) {
    // Cross-repo resolution: cli/ → /CascadeProjects/a-nice-terminal (v3),
    // ANT-Open-Slide/ → /CascadeProjects/ANT-Open-Slide (delivery-plan),
    // everything else → /CascadeProjects/ant (fresh-ant, default).
    let fullPath;
    if (ref.startsWith('cli/')) fullPath = join(REPO_ROOT, '..', 'a-nice-terminal', ref);
    else if (ref.startsWith('ANT-Open-Slide')) fullPath = join(REPO_ROOT, '..', ref);
    else fullPath = join(REPO_ROOT, ref);
    if (!existsSync(fullPath)) missingRefs.push(ref);
    else if (!statSync(fullPath).isFile()) missingRefs.push(ref);
  }
  if (missingRefs.length > 0) throw new Error(`source_ref files missing: ${missingRefs.join(', ')}`);
  writeOut(`source_ref files: ${refs.length} all exist on disk`);
  writeOut('ALIGNMENT OK — manifest ↔ rendered ↔ source_ref files all in lockstep');
  return { sourceIds: sourceIds.size, renderedIds: renderedIds.size, sourceRefs: refs.length };
}

const isEntry = typeof process !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  runAlignmentCheck().catch((err) => { process.stderr.write(`${err.message}\n`); process.exit(1); });
}
