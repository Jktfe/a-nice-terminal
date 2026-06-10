/**
 * scripts/audit-visual-regression.mjs
 *
 * Auto-screenshot regression suite — pre-OSS-launch ship gate.
 *
 * rover-evolveantux task 328e9302 (per ratified ask): Playwright-driven
 * capture of 8 key surfaces per deploy, stored under
 * ObsidiANT/audits/visual-snapshots/<short-sha>/ with a sibling
 * manifest.json. Then file-size diffs each surface against the most-
 * recent prior snapshot set, flagging anything that shifted ≥5%.
 *
 * Pragmatic v1 — full pixelmatch is flagged as next-iter (adds the
 * pixelmatch + pngjs npm deps and a per-pixel diff write). For OSS
 * launch the file-size delta catches the loud regressions (blank
 * pages, layout collapse, missing chrome) and is enough as a smoke
 * gate.
 *
 * Usage:
 *   ANT_VISREG_BASE_URL=http://localhost:6174 \
 *   ANT_DEMO_EMAIL=… ANT_DEMO_PASSWORD=… \
 *   bunx playwright install chromium --with-deps  # one-time
 *   node scripts/audit-visual-regression.mjs
 *
 * CI wiring: run on every push to main after the dev server is up.
 * Non-zero exit when any surface shifts ≥5% OR a capture fails, so a
 * GitHub Actions job can fail the run.
 *
 * Pairs with scripts/manual-harvest.mjs (same capture pipeline,
 * different sink — manual-harvest writes external assets under
 * ~/ant-assets/a-nice-terminal/manual, this writes the dated-snapshot dir).
 */

import { chromium } from 'playwright';
import { mkdir, writeFile, readdir, stat, readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.ANT_VISREG_BASE_URL ?? 'http://localhost:6174';
const SNAPSHOTS_ROOT = join(
  REPO_ROOT,
  '..',
  'ObsidiANT',
  'audits',
  'visual-snapshots'
);
const DELTA_THRESHOLD_PCT = Number(process.env.ANT_VISREG_DELTA_PCT ?? '5');

// Eight key surfaces — the smoke set. Add to this list as new public
// routes ship (and keep the slug stable; the diff machinery keys on it).
const SURFACES = [
  { slug: 'dashboard',         path: '/' },
  { slug: 'rooms-index',       path: '/rooms' },
  { slug: 'rooms-detail',      path: '/rooms/zj4jlety9q' },
  { slug: 'plans-index',       path: '/plans' },
  { slug: 'plans-detail',      path: '/plans/v4-fresh-ant' },
  { slug: 'discover-verbs',    path: '/discover' },
  { slug: 'discover-visuals',  path: '/discover/visuals' },
  { slug: 'manual',            path: '/manual' }
];

function shortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT })
      .toString().trim();
  } catch {
    return `local-${Date.now()}`;
  }
}

async function listPriorSnapshotDirs() {
  try {
    const entries = await readdir(SNAPSHOTS_ROOT, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    // Sort by mtime descending — newest first
    const annotated = await Promise.all(
      dirs.map(async (name) => {
        const s = await stat(join(SNAPSHOTS_ROOT, name));
        return { name, mtimeMs: s.mtimeMs };
      })
    );
    annotated.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return annotated.map((a) => a.name);
  } catch {
    return [];
  }
}

async function readPriorManifest(dirName) {
  try {
    const raw = await readFile(
      join(SNAPSHOTS_ROOT, dirName, 'manifest.json'),
      'utf8'
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function captureAll(sha) {
  const outDir = join(SNAPSHOTS_ROOT, sha);
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  // Demo-login fallback so authenticated routes capture properly.
  if (process.env.ANT_DEMO_EMAIL && process.env.ANT_DEMO_PASSWORD) {
    try {
      const resp = await page.request.post(`${BASE_URL}/api/auth/demo-login`, {
        data: {
          email: process.env.ANT_DEMO_EMAIL,
          password: process.env.ANT_DEMO_PASSWORD
        }
      });
      if (resp.ok()) {
        console.log('[auth] demo-login succeeded');
      } else {
        console.warn(`[auth] demo-login ${resp.status()} — capturing as anonymous`);
      }
    } catch (cause) {
      console.warn(`[auth] demo-login threw — ${cause.message ?? cause}`);
    }
  } else {
    console.warn('[auth] no demo creds — capturing as anonymous (login screens may dominate)');
  }

  const captures = [];
  for (const surface of SURFACES) {
    const url = `${BASE_URL}${surface.path}`;
    const outPath = join(outDir, `${surface.slug}.png`);
    try {
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 15000
      });
      const status = response?.status() ?? 0;
      await page.waitForTimeout(500); // hydration settle
      await page.screenshot({ path: outPath, fullPage: false });
      const size = (await stat(outPath)).size;
      captures.push({ slug: surface.slug, url, status, sizeBytes: size, ok: true });
      console.log(`[ok ${status}] ${surface.slug} (${size} bytes) ← ${url}`);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      captures.push({ slug: surface.slug, url, ok: false, reason });
      console.error(`[FAIL] ${surface.slug} ← ${url} :: ${reason}`);
    }
  }

  await browser.close();
  return { outDir, captures };
}

function diffAgainstPrior(currentCaptures, priorManifest) {
  if (!priorManifest || !Array.isArray(priorManifest.captures)) {
    return { hasPrior: false, deltas: [] };
  }
  const priorBySlug = new Map(
    priorManifest.captures.filter((c) => c.ok).map((c) => [c.slug, c.sizeBytes])
  );
  const deltas = [];
  for (const cur of currentCaptures) {
    if (!cur.ok) continue;
    const prior = priorBySlug.get(cur.slug);
    if (prior === undefined) {
      deltas.push({ slug: cur.slug, kind: 'new', currentSize: cur.sizeBytes });
      continue;
    }
    const deltaPct = ((cur.sizeBytes - prior) / prior) * 100;
    const beyondThreshold = Math.abs(deltaPct) >= DELTA_THRESHOLD_PCT;
    deltas.push({
      slug: cur.slug,
      kind: beyondThreshold ? 'flag' : 'within',
      priorSize: prior,
      currentSize: cur.sizeBytes,
      deltaPct: Number(deltaPct.toFixed(2))
    });
  }
  return { hasPrior: true, priorSha: priorManifest.sha, deltas };
}

async function main() {
  const sha = shortSha();
  console.log(`Visual regression suite — sha=${sha} surfaces=${SURFACES.length}`);
  console.log(`Snapshots → ${SNAPSHOTS_ROOT}/${sha}/`);
  console.log('');

  const priorDirs = (await listPriorSnapshotDirs()).filter((d) => d !== sha);
  const priorManifest = priorDirs.length > 0 ? await readPriorManifest(priorDirs[0]) : null;
  if (priorManifest) {
    console.log(`Will diff against prior snapshot set: ${priorDirs[0]}`);
  } else {
    console.log('No prior snapshot set found — capturing baseline only');
  }
  console.log('');

  const { outDir, captures } = await captureAll(sha);
  const diff = diffAgainstPrior(captures, priorManifest);

  const manifest = {
    sha,
    capturedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    deltaThresholdPct: DELTA_THRESHOLD_PCT,
    captures,
    diff
  };
  await writeFile(
    join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Summary
  console.log('');
  console.log('─────────────────────────────────────────────────────');
  const okCount = captures.filter((c) => c.ok).length;
  const failCount = captures.length - okCount;
  console.log(`Captured: ${okCount}/${captures.length} surfaces`);
  if (failCount > 0) console.log(`Failed:   ${failCount} (see [FAIL] lines above)`);

  if (diff.hasPrior) {
    const flagged = diff.deltas.filter((d) => d.kind === 'flag');
    const newSurfaces = diff.deltas.filter((d) => d.kind === 'new');
    console.log(`Diff vs ${diff.priorSha}: ${diff.deltas.length} compared, ${flagged.length} beyond ±${DELTA_THRESHOLD_PCT}%, ${newSurfaces.length} new`);
    for (const f of flagged) {
      console.log(`  ⚠️  ${f.slug}: ${f.priorSize} → ${f.currentSize} bytes (${f.deltaPct >= 0 ? '+' : ''}${f.deltaPct}%)`);
    }
    for (const n of newSurfaces) {
      console.log(`  ➕ ${n.slug}: ${n.currentSize} bytes (new baseline)`);
    }
  } else {
    console.log('No prior snapshot — baseline established.');
  }
  console.log(`Manifest: ${join(outDir, 'manifest.json')}`);
  console.log('─────────────────────────────────────────────────────');

  // Next-iteration note for the operator reading the log.
  console.log('');
  console.log('Next-iter: install pixelmatch + pngjs and add a per-pixel');
  console.log('diff that writes <slug>.diff.png alongside each captured');
  console.log('PNG. File-size delta catches loud regressions; pixelmatch');
  console.log('catches subtle ones (colour shifts, 1-pixel layout drift).');

  // Non-zero exit when capture failed or any flag tripped — lets CI fail.
  if (failCount > 0) process.exit(2);
  const flaggedCount = diff.deltas.filter((d) => d.kind === 'flag').length;
  if (flaggedCount > 0) process.exit(3);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
