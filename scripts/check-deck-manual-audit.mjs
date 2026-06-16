#!/usr/bin/env node
// check-deck-manual-audit — m5.6 Deck/manual audit proof.
// Reports DP↔manifest drift in BOTH directions:
//   - aspirational backlog: DP-promised verbs not yet in manifest
//   - shipped-not-promised: manifest verbs not yet documented in DP
// HARD ASSERT: structural sanity only — files exist, both have content,
// and overlap is non-trivial. Drift counts are INFORMATIONAL because
// either side can legitimately lead the other (DP can promise ahead,
// manifest can ship operational verbs that don't deserve DP slides yet).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const MANIFEST_PATH = join(REPO_ROOT, 'src/lib/cli-manifest/manifest.ts');
// The delivery plan lives in the sibling ANT-Open-Slide repo, which is not
// present in every checkout (CI, /tmp worktrees, fresh clones). Exported so
// the test can skip itself when the external file is absent rather than
// crashing the whole suite on ENOENT.
export const DELIVERY_PLAN_PATH = join(REPO_ROOT, '..', 'ANT-Open-Slide',
  'fresh-ant-rules-manual-2026-05-13', 'DELIVERY-PLAN.md');
export const deliveryPlanAvailable = () => existsSync(DELIVERY_PLAN_PATH);

function manifestPrimaryVerbs() {
  const src = readFileSync(MANIFEST_PATH, 'utf8');
  const verbs = new Set();
  // delta-1 fix: extend factory regex to include pl + nw rows so planned
  // entries (chair/interview/voice etc) are not falsely flagged as drift.
  for (const m of src.matchAll(/(?:^|\s)(?:av|pl|nw)\(\s*'[^']+'\s*,\s*'([^']+)'/g)) verbs.add(m[1]);
  // Object-literal pattern: { id: 'x', primaryVerb: 'foo', ... }
  for (const m of src.matchAll(/primaryVerb:\s*'([^']+)'/g)) verbs.add(m[1]);
  return verbs;
}

function deliveryPlanVerbs() {
  const md = readFileSync(DELIVERY_PLAN_PATH, 'utf8');
  const verbs = new Set();
  // Each `ant <verb>...` mention; first token after `ant ` is the primaryVerb.
  // delta-1 cleanup: skip leading-hyphen tokens like --help (not a real verb).
  for (const m of md.matchAll(/`ant\s+([\w][\w-]*)/g)) verbs.add(m[1]);
  return verbs;
}

export function runDeckManualAudit({ writeOut = console.log } = {}) {
  writeOut(`probe: manifest=${MANIFEST_PATH}`);
  writeOut(`probe: delivery-plan=${DELIVERY_PLAN_PATH}`);
  const manifestVerbs = manifestPrimaryVerbs();
  const dpVerbs = deliveryPlanVerbs();
  writeOut(`manifest primaryVerbs: ${manifestVerbs.size}`);
  writeOut(`delivery-plan ant verbs: ${dpVerbs.size}`);
  // STRUCTURAL ASSERT: both surfaces have content + non-trivial overlap.
  if (manifestVerbs.size === 0) throw new Error('no primaryVerbs extracted from manifest');
  if (dpVerbs.size === 0) throw new Error('no ant verbs extracted from DELIVERY-PLAN.md');
  // "rooms" manifest entry is the legacy; DP uses "room" — alias-equivalent.
  const aliases = { rooms: 'room' };
  const overlap = [...manifestVerbs].filter((v) => dpVerbs.has(v) || (aliases[v] && dpVerbs.has(aliases[v])));
  if (overlap.length < Math.min(manifestVerbs.size, dpVerbs.size) / 4) {
    throw new Error(`overlap too small (${overlap.length}) — likely parser regression`);
  }
  // INFORMATIONAL: drift in both directions.
  const shippedNotPromised = [...manifestVerbs].filter((v) => !dpVerbs.has(v) && !(aliases[v] && dpVerbs.has(aliases[v]))).sort();
  const aspirational = [...dpVerbs].filter((v) => !manifestVerbs.has(v) && !Object.values(aliases).includes(v)).sort();
  writeOut(`overlap (shipped-and-promised): ${overlap.length}`);
  writeOut(`shipped-not-promised (${shippedNotPromised.length}): ${shippedNotPromised.join(', ') || '(none)'}`);
  writeOut(`aspirational-backlog (${aspirational.length}): ${aspirational.join(', ') || '(none)'}`);
  writeOut('AUDIT OK — DP↔manifest both readable, structural sanity holds');
  return { manifestVerbs: manifestVerbs.size, dpVerbs: dpVerbs.size, overlap: overlap.length, shippedNotPromised: shippedNotPromised.length, aspirational: aspirational.length };
}

const isEntry = typeof process !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  try { runDeckManualAudit(); }
  catch (err) { process.stderr.write(`${err.message}\n`); process.exit(1); }
}
