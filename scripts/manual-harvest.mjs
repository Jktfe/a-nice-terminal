/**
 * scripts/manual-harvest.mjs
 *
 * Playwright-driven screenshot harvester for the /manual canvas.
 * Captures each route at a fixed laptop viewport (1280×800) and writes
 * PNGs into the external asset root at manual/<slug>.png so the manual
 * page can load them through /api/assets/manual/<slug>.png.
 *
 * Usage:
 *   ANT_HARVEST_BASE_URL=http://localhost:6174 \
 *   ANT_BROWSER_SESSION=bws_xxx \
 *   bunx playwright install chromium --with-deps  # one-time
 *   node scripts/manual-harvest.mjs
 *
 * The harvester needs an authenticated browser session for any route
 * that redirects to /login. The session cookie is read from
 * ANT_BROWSER_SESSION env so this script doesn't have to know how
 * the operator's cookie was minted. Run `ant config` to see your
 * current cookie if you need it.
 *
 * If the cookie env is unset, the script captures whatever the public
 * route serves (typically the login page) — fine for /antonline-dev /
 * /manual / /login / /r/[inviteId] which are all public.
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.ANT_HARVEST_BASE_URL ?? 'http://localhost:6174';
const COOKIE = process.env.ANT_BROWSER_SESSION ?? '';
const OUT_DIR =
  process.env.ANT_MANUAL_ASSETS_DIR ?? join(homedir(), 'ant-assets', 'a-nice-terminal', 'manual');

// Same slugs as the manual canvas tiles. Each slug → route to capture
// + an optional "tweak" function that lets us hover/click before
// the shot if the screen needs to be in a particular state.
const TARGETS = [
  { slug: 'rooms-index', path: '/rooms' },
  { slug: 'vault', path: '/vault' },
  { slug: 'plans-index', path: '/plans' },
  { slug: 'plan-evidence', path: '/plans/evidence' },
  { slug: 'memory-recall', path: '/memory' },
  { slug: 'search', path: '/search' },
  { slug: 'invite-redeem', path: '/r/invite-placeholder' },
  { slug: 'terminals-index', path: '/terminals' },
  { slug: 'dashboard', path: '/' },
  { slug: 'settings', path: '/settings' },
  { slug: 'discover', path: '/discover' },
  { slug: 'policies', path: '/policies' },
  // antonline-dev preview gets captured too — useful as a tile in the
  // manual canvas itself once we add a marketing cluster.
  { slug: 'antonline-dev', path: '/antonline-dev' },
  // cli-gold-06 (2026-05-19) — manual page references these slugs but
  // no PNG existed: harvester now captures them too. Paths point at a
  // representative real room / plan / terminal so the screenshot shows
  // actual content rather than an empty shell. ANT_HARVEST_ROOM_ID /
  // ANT_HARVEST_PLAN_ID can override the defaults if you want to point
  // at a different demo room/plan.
  {
    slug: 'room-view',
    path: `/rooms/${process.env.ANT_HARVEST_ROOM_ID ?? 'zj4jlety9q'}`
  },
  {
    slug: 'room-participants',
    // The participants section is rendered inline on the room page; the
    // hash deep-link auto-opens the CollapsibleSection (banked in the
    // CollapsibleSection.svelte onMount hash handler).
    path: `/rooms/${process.env.ANT_HARVEST_ROOM_ID ?? 'zj4jlety9q'}#participants`
  },
  {
    slug: 'plan-detail',
    path: `/plans/${process.env.ANT_HARVEST_PLAN_ID ?? 'v4-fresh-ant'}`
  },
  {
    slug: 'terminal-detail',
    // No dedicated /terminals/[id] route — the detail surface lives on
    // /terminals as a card. Capture the index; the manual tile copy is
    // about "one terminal" but the visual is still the same row.
    path: '/terminals'
  },
  {
    slug: 'remote-bridge',
    // /policies has the remote-mapping section; /settings doesn't.
    // Closest match for the 'Another ANT machine talks safely to ours'
    // tile copy — operator can swap this when a dedicated route lands.
    path: '/policies'
  }
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2 // retina-quality PNGs
  });

  if (COOKIE) {
    await context.addCookies([
      {
        name: 'ant_browser_session',
        value: COOKIE,
        url: BASE_URL
      }
    ]);
  }

  const page = await context.newPage();

  // Demo-login fallback so the harvester can capture authenticated routes
  // without an explicit ANT_BROWSER_SESSION env. Reads the demo creds from
  // ANT_DEMO_EMAIL + ANT_DEMO_PASSWORD env (sourced from ~/.ant/secrets.env
  // when the operator runs `source ~/.ant/secrets.env` first). Without
  // either path, the harvest captures the /login page for every route —
  // still useful as evidence of the unauthenticated entry, but not what
  // the manual canvas needs.
  if (!COOKIE && process.env.ANT_DEMO_EMAIL && process.env.ANT_DEMO_PASSWORD) {
    try {
      const loginResp = await page.request.post(`${BASE_URL}/api/auth/demo-login`, {
        data: {
          email: process.env.ANT_DEMO_EMAIL,
          password: process.env.ANT_DEMO_PASSWORD
        }
      });
      if (loginResp.ok()) {
        console.log('[auth] demo-login succeeded — capturing authenticated routes');
      } else {
        console.warn(`[auth] demo-login returned ${loginResp.status()} — falling back to unauthenticated capture`);
      }
    } catch (cause) {
      console.warn(`[auth] demo-login threw — ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  const results = [];
  for (const target of TARGETS) {
    const url = `${BASE_URL}${target.path}`;
    const outPath = join(OUT_DIR, `${target.slug}.png`);
    // Room pages keep an SSE connection open so 'networkidle' never
    // fires; fall back to 'domcontentloaded' + a slightly longer hydrate
    // wait so we still get a representative render without the timeout.
    const isSsePage = target.path.startsWith('/rooms/');
    const waitUntil = isSsePage ? 'domcontentloaded' : 'networkidle';
    const hydrateMs = isSsePage ? 1500 : 500;
    try {
      const response = await page.goto(url, { waitUntil, timeout: 15000 });
      const status = response?.status() ?? 0;
      await page.waitForTimeout(hydrateMs);
      await page.screenshot({ path: outPath, fullPage: false });
      results.push({ slug: target.slug, url, status, ok: true });
      console.log(`[ok ${status}] ${target.slug} ← ${url}`);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      results.push({ slug: target.slug, url, ok: false, reason });
      console.error(`[FAIL] ${target.slug} ← ${url} :: ${reason}`);
    }
  }

  await browser.close();

  // Write a manifest so the canvas knows which slugs have real PNGs.
  await writeFile(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), targets: results }, null, 2)
  );
  console.log(`\nharvested ${results.filter((r) => r.ok).length}/${TARGETS.length} → ${OUT_DIR}`);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
