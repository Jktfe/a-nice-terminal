#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ROUTE_PATHS = [
  '/',
  '/rooms',
  '/plans',
  '/discover',
  '/discover/visuals',
  '/manual',
  '/login'
];

export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]'
].join(', ');

const DEFAULT_BASE_URL = 'http://127.0.0.1:6174';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SETTLE_MS = 400;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const DEFAULT_MAX_ROUTES = 8;
const DEFAULT_MAX_ELEMENTS = 120;
const DEFAULT_MAX_CLICKS_PER_ROUTE = 3;
const HARD_ROUTE_LIMIT = 20;

const DANGEROUS_WORDS = /\b(delete|remove|destroy|kill|purge|drop|wipe|reset|archive|approve|grant|revoke|deny|block|unblock|invite|join|leave|claim|release|accept|reject|send|submit|post|reply|message|chat|comment|publish|save|update|create|new|upload|import|export|start|stop|run|execute|restart|shutdown|login|logout|sign\s*in|sign\s*out|vote|pay|checkout)\b/i;
const SAFE_NAV_WORDS = /\b(home|dashboard|rooms?|plans?|discover|visuals?|manual|docs?|help|status|settings?|overview|back|next|previous|details?|view|open|stage|decks?|terminals?)\b/i;

export class CliInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliInputError';
  }
}

export function usage() {
  return [
    'Usage:',
    '  node scripts/browser-ux-sweep.mjs --artifact-dir <dir> [options]',
    '',
    'Options:',
    `  --base-url <url>                 ANT base URL (default: ${DEFAULT_BASE_URL})`,
    '  --artifact-dir <dir>             Required output directory for screenshots and logs',
    '  --route <path-or-url>            Route to visit; repeatable',
    '  --routes <csv>                   Comma-separated routes to visit',
    `  --max-routes <n>                 Bound route count (default: ${DEFAULT_MAX_ROUTES}, max: ${HARD_ROUTE_LIMIT})`,
    `  --max-elements <n>               Max interactive elements recorded per route (default: ${DEFAULT_MAX_ELEMENTS})`,
    `  --max-clicks-per-route <n>       Safe same-origin link clicks per route (default: ${DEFAULT_MAX_CLICKS_PER_ROUTE})`,
    '  --no-clicks                      Visit routes and collect elements only',
    `  --timeout-ms <n>                 Navigation timeout (default: ${DEFAULT_TIMEOUT_MS})`,
    `  --settle-ms <n>                  Hydration settle wait after load (default: ${DEFAULT_SETTLE_MS})`,
    '  --viewport <width>x<height>      Browser viewport (default: 1280x800)',
    '  --storage-state <file>           Optional Playwright storage state for authenticated sweeps',
    '  --headed                         Run Chromium headed',
    '  --fail-on-console-error          Exit non-zero if browser console errors are seen',
    '  --help                           Show this help',
    '',
    'Safety:',
    '  Default clicks are limited to visible same-origin links that look navigational.',
    '  Buttons, form controls, external links, API links, and destructive/action labels are skipped.'
  ].join('\n');
}

export function buildConfigFromArgs(argv, env = process.env, cwd = process.cwd()) {
  const options = {
    baseUrlText: env.ANT_UX_SWEEP_BASE_URL || DEFAULT_BASE_URL,
    artifactDirText: env.ANT_UX_SWEEP_ARTIFACT_DIR || '',
    routeInputs: [],
    maxRoutes: DEFAULT_MAX_ROUTES,
    maxElements: DEFAULT_MAX_ELEMENTS,
    maxClicksPerRoute: DEFAULT_MAX_CLICKS_PER_ROUTE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    settleMs: DEFAULT_SETTLE_MS,
    viewport: { ...DEFAULT_VIEWPORT },
    storageStatePath: env.ANT_UX_SWEEP_STORAGE_STATE || '',
    headless: true,
    failOnConsoleError: false,
    noClicks: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    if (arg === '--base-url') {
      options.baseUrlText = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--artifact-dir') {
      options.artifactDirText = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--route') {
      options.routeInputs.push(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === '--routes') {
      options.routeInputs.push(
        ...requireValue(argv, index, arg).split(',').map((part) => part.trim()).filter(Boolean)
      );
      index += 1;
    } else if (arg === '--max-routes') {
      options.maxRoutes = parseBoundedInteger(requireValue(argv, index, arg), arg, 1, HARD_ROUTE_LIMIT);
      index += 1;
    } else if (arg === '--max-elements') {
      options.maxElements = parseBoundedInteger(requireValue(argv, index, arg), arg, 1, 500);
      index += 1;
    } else if (arg === '--max-clicks-per-route') {
      options.maxClicksPerRoute = parseBoundedInteger(requireValue(argv, index, arg), arg, 0, 10);
      index += 1;
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = parseBoundedInteger(requireValue(argv, index, arg), arg, 1000, 120000);
      index += 1;
    } else if (arg === '--settle-ms') {
      options.settleMs = parseBoundedInteger(requireValue(argv, index, arg), arg, 0, 10000);
      index += 1;
    } else if (arg === '--viewport') {
      options.viewport = parseViewport(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === '--storage-state') {
      options.storageStatePath = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--headed') {
      options.headless = false;
    } else if (arg === '--fail-on-console-error') {
      options.failOnConsoleError = true;
    } else if (arg === '--no-clicks') {
      options.noClicks = true;
    } else {
      throw new CliInputError(`Unknown option: ${arg}`);
    }
  }

  if (!options.artifactDirText.trim()) {
    throw new CliInputError('Missing required --artifact-dir <dir> or ANT_UX_SWEEP_ARTIFACT_DIR.');
  }

  const baseUrl = normalizeBaseUrl(options.baseUrlText);
  const routes = (options.routeInputs.length > 0 ? options.routeInputs : DEFAULT_ROUTE_PATHS)
    .map((input) => normalizeRouteInput(input, baseUrl.href))
    .slice(0, options.maxRoutes);

  return {
    help: false,
    baseUrl: baseUrl.href.replace(/\/$/, ''),
    artifactDir: resolvePath(options.artifactDirText, cwd),
    routes,
    maxRoutes: options.maxRoutes,
    maxElements: options.maxElements,
    maxClicksPerRoute: options.noClicks ? 0 : options.maxClicksPerRoute,
    timeoutMs: options.timeoutMs,
    settleMs: options.settleMs,
    viewport: options.viewport,
    storageStatePath: options.storageStatePath ? resolvePath(options.storageStatePath, cwd) : '',
    headless: options.headless,
    failOnConsoleError: options.failOnConsoleError
  };
}

export function normalizeBaseUrl(input) {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new CliInputError(`Base URL must use http or https: ${input}`);
    }
    url.hash = '';
    url.search = '';
    return url;
  } catch (cause) {
    if (cause instanceof CliInputError) throw cause;
    throw new CliInputError(`Invalid --base-url: ${input}`);
  }
}

export function normalizeRouteInput(input, baseUrl) {
  if (!input || !input.trim()) {
    throw new CliInputError('Route values cannot be blank.');
  }
  let url;
  try {
    url = new URL(input.trim(), baseUrl);
  } catch {
    throw new CliInputError(`Invalid route: ${input}`);
  }

  const base = new URL(baseUrl);
  if (url.origin !== base.origin) {
    throw new CliInputError(`Route must stay on the ANT base origin: ${input}`);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function makeRouteSlug(routePath) {
  const slug = routePath
    .replace(/^[#/]+/, '')
    .replace(/[?#]+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'root';
}

export function explainNavigationSafety(element, { baseUrl, currentUrl = baseUrl } = {}) {
  if (!element || !element.visible) return { safe: false, reason: 'not visible' };
  if (element.disabled) return { safe: false, reason: 'disabled' };

  const tagName = String(element.tagName || '').toLowerCase();
  const role = String(element.role || '').toLowerCase();
  const isLinkLike = tagName === 'a' || role === 'link';
  if (!isLinkLike) return { safe: false, reason: 'not a link' };
  if (!element.href) return { safe: false, reason: 'missing href' };
  if (element.download) return { safe: false, reason: 'download link' };
  if (element.target && !['', '_self'].includes(element.target)) {
    return { safe: false, reason: 'new tab or named target' };
  }

  let url;
  let base;
  let current;
  try {
    base = new URL(baseUrl);
    current = new URL(currentUrl, base.href);
    url = new URL(element.href, current.href);
  } catch {
    return { safe: false, reason: 'invalid href' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { safe: false, reason: 'non-http link' };
  }
  if (url.origin !== base.origin) {
    return { safe: false, reason: 'external origin' };
  }
  if (url.pathname.startsWith('/api/')) {
    return { safe: false, reason: 'api link' };
  }

  const label = compactText([
    element.text,
    element.ariaLabel,
    element.title,
    element.href
  ].filter(Boolean).join(' '));
  if (DANGEROUS_WORDS.test(label)) {
    return { safe: false, reason: 'action or destructive label' };
  }

  const sameDocumentHash =
    url.pathname === current.pathname &&
    url.search === current.search &&
    Boolean(url.hash);

  if (element.navAncestor) return { safe: true, reason: 'navigation ancestor' };
  if (SAFE_NAV_WORDS.test(label)) return { safe: true, reason: 'navigation label' };
  if (sameDocumentHash) return { safe: true, reason: 'same-page hash link' };

  return { safe: false, reason: 'not clearly navigational' };
}

export function isSafeNavigationCandidate(element, options) {
  return explainNavigationSafety(element, options).safe;
}

export function chooseSafeNavigationCandidates(elements, options) {
  const seen = new Set();
  const candidates = [];
  const limit = options.maxClicksPerRoute ?? DEFAULT_MAX_CLICKS_PER_ROUTE;
  if (limit <= 0) return candidates;
  for (const element of elements) {
    const decision = explainNavigationSafety(element, options);
    if (!decision.safe) continue;
    const key = `${element.href || ''}|${compactText(element.text || element.ariaLabel || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...element, safeReason: decision.reason });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

export async function collectInteractiveElements(page, maxElements) {
  return page.evaluate(
    ({ selector, max }) => {
      function textFor(el) {
        const tag = el.tagName.toLowerCase();
        const aria = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const name = el.getAttribute('name') || '';
        const type = el.getAttribute('type') || '';
        if (['input', 'textarea', 'select'].includes(tag)) {
          return aria || placeholder || title || name || type || tag;
        }
        return el.innerText || el.textContent || aria || title || tag;
      }

      function hasNavigationAncestor(el) {
        let current = el.parentElement;
        while (current) {
          const tag = current.tagName.toLowerCase();
          const role = (current.getAttribute('role') || '').toLowerCase();
          const aria = (current.getAttribute('aria-label') || '').toLowerCase();
          if (['nav', 'header', 'aside', 'footer'].includes(tag)) return true;
          if (role === 'navigation') return true;
          if (aria.includes('nav')) return true;
          current = current.parentElement;
        }
        return false;
      }

      function compact(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      }

      return Array.from(document.querySelectorAll(selector)).slice(0, max).map((el, index) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const disabled =
          Boolean(el.disabled) ||
          el.getAttribute('aria-disabled') === 'true' ||
          Boolean(el.closest('[inert]'));
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0';

        return {
          index,
          tagName: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          type: el.getAttribute('type') || '',
          text: compact(textFor(el)),
          ariaLabel: compact(el.getAttribute('aria-label') || ''),
          title: compact(el.getAttribute('title') || ''),
          href: typeof el.href === 'string' ? el.href : '',
          hrefAttribute: el.getAttribute('href') || '',
          target: el.getAttribute('target') || '',
          download: el.hasAttribute('download'),
          disabled,
          visible,
          navAncestor: hasNavigationAncestor(el),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        };
      });
    },
    { selector: INTERACTIVE_SELECTOR, max: maxElements }
  );
}

export async function runSweep(config) {
  await mkdir(config.artifactDir, { recursive: true });
  const screenshotDir = join(config.artifactDir, 'screenshots');
  await mkdir(screenshotDir, { recursive: true });

  const logLines = [];
  const routeSlugCounts = new Map();
  const browserEvents = [];
  const manifest = {
    ok: false,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    baseUrl: config.baseUrl,
    routes: config.routes,
    limits: {
      maxRoutes: config.maxRoutes,
      maxElements: config.maxElements,
      maxClicksPerRoute: config.maxClicksPerRoute,
      timeoutMs: config.timeoutMs,
      settleMs: config.settleMs
    },
    viewport: config.viewport,
    storageStateUsed: Boolean(config.storageStatePath),
    visits: [],
    browserEvents
  };

  const log = (line = '') => {
    const cleaned = redactForLog(line);
    const stamped = `[${new Date().toISOString()}] ${cleaned}`;
    logLines.push(stamped);
    console.log(stamped);
  };

  let browser;
  try {
    const { chromium } = await loadPlaywright();
    log(`ANT browser UX sweep starting: ${config.baseUrl}`);
    log(`Artifacts: ${config.artifactDir}`);
    log(`Routes: ${config.routes.join(', ')}`);
    if (config.maxClicksPerRoute === 0) {
      log('Safe clicks disabled.');
    } else {
      log(`Safe clicks per route: ${config.maxClicksPerRoute}`);
    }

    browser = await chromium.launch({ headless: config.headless });
    const context = await browser.newContext({
      viewport: config.viewport,
      deviceScaleFactor: 1,
      storageState: config.storageStatePath || undefined
    });
    const page = await context.newPage();
    wireBrowserEventCapture(page, browserEvents, log);

    for (const routePath of config.routes) {
      const visit = await visitRoute({
        page,
        config,
        routePath,
        screenshotDir,
        routeSlugCounts,
        log
      });
      manifest.visits.push(visit);
    }

    await context.close();
    const failedVisits = manifest.visits.filter((visit) => !visit.ok);
    const consoleErrors = browserEvents.filter((event) => event.kind === 'console' && event.type === 'error');
    manifest.ok = failedVisits.length === 0 && (!config.failOnConsoleError || consoleErrors.length === 0);
    log(`Sweep complete: ${manifest.visits.length - failedVisits.length}/${manifest.visits.length} routes loaded.`);
    if (failedVisits.length > 0) log(`Failed route visits: ${failedVisits.length}`);
    if (consoleErrors.length > 0) log(`Console errors observed: ${consoleErrors.length}`);
  } catch (cause) {
    manifest.error = formatError(cause);
    log(`Sweep failed: ${manifest.error}`);
    throw cause;
  } finally {
    if (browser) await browser.close().catch(() => {});
    manifest.finishedAt = new Date().toISOString();
    await writeFile(join(config.artifactDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(join(config.artifactDir, 'sweep.log'), `${logLines.join('\n')}\n`);
  }

  return manifest;
}

async function visitRoute({ page, config, routePath, screenshotDir, routeSlugCounts, log }) {
  const url = routeToUrl(config.baseUrl, routePath);
  const slug = uniqueSlug(makeRouteSlug(routePath), routeSlugCounts);
  const screenshotPath = join(screenshotDir, `${slug}.png`);
  const visit = {
    route: routePath,
    url,
    status: null,
    ok: false,
    screenshot: relative(config.artifactDir, screenshotPath),
    interactiveCount: 0,
    safeCandidateCount: 0,
    interactiveElements: [],
    safeClicks: []
  };

  log(`Route ${routePath}: open ${url}`);
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeoutMs
    });
    await settlePage(page, config);
    visit.status = response?.status() ?? null;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    visit.interactiveElements = await collectInteractiveElements(page, config.maxElements);
    visit.interactiveCount = visit.interactiveElements.length;

    const safeCandidates = chooseSafeNavigationCandidates(visit.interactiveElements, {
      baseUrl: config.baseUrl,
      currentUrl: page.url(),
      maxClicksPerRoute: config.maxClicksPerRoute
    });
    visit.safeCandidateCount = safeCandidates.length;
    log(`Route ${routePath}: ${visit.interactiveCount} interactive elements, ${safeCandidates.length} safe click candidates.`);

    for (let clickIndex = 0; clickIndex < safeCandidates.length; clickIndex += 1) {
      const safeClick = await clickSafeCandidate({
        page,
        config,
        routePath,
        routeUrl: url,
        routeSlug: slug,
        candidate: safeCandidates[clickIndex],
        clickNumber: clickIndex + 1,
        screenshotDir,
        log
      });
      visit.safeClicks.push(safeClick);
    }

    visit.ok = visit.status === null || visit.status < 400;
  } catch (cause) {
    visit.error = formatError(cause);
    log(`Route ${routePath}: failed - ${visit.error}`);
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
  }
  return visit;
}

async function clickSafeCandidate({
  page,
  config,
  routePath,
  routeUrl,
  routeSlug,
  candidate,
  clickNumber,
  screenshotDir,
  log
}) {
  const label = compactText(candidate.text || candidate.ariaLabel || candidate.href || 'link');
  const clickSlug = makeRouteSlug(`${routeSlug}-click-${clickNumber}-${label}`).slice(0, 90);
  const screenshotPath = join(screenshotDir, `${clickSlug}.png`);
  const result = {
    label,
    href: candidate.href,
    reason: candidate.safeReason,
    ok: false,
    beforeUrl: routeUrl,
    afterUrl: '',
    screenshot: relative(config.artifactDir, screenshotPath)
  };

  try {
    await page.goto(routeUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    await settlePage(page, config);
    const freshElements = await collectInteractiveElements(page, config.maxElements);
    const fresh = findFreshCandidate(freshElements, candidate, {
      baseUrl: config.baseUrl,
      currentUrl: page.url()
    });
    if (!fresh) {
      result.error = 'candidate no longer found';
      log(`Route ${routePath}: skipped safe click ${clickNumber} (${label}) - candidate changed.`);
      return result;
    }

    log(`Route ${routePath}: safe click ${clickNumber} (${label}) -> ${fresh.href}`);
    const locator = page.locator(INTERACTIVE_SELECTOR).nth(fresh.index);
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await locator.click({ timeout: 5000 });
    await settlePage(page, config);
    result.afterUrl = page.url();
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.ok = true;
  } catch (cause) {
    result.error = formatError(cause);
    log(`Route ${routePath}: safe click ${clickNumber} failed - ${result.error}`);
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
  }

  return result;
}

function findFreshCandidate(elements, candidate, options) {
  const matches = elements.filter((element) => {
    if (element.href !== candidate.href) return false;
    if (!isSafeNavigationCandidate(element, options)) return false;
    const oldText = compactText(candidate.text || candidate.ariaLabel || '');
    const newText = compactText(element.text || element.ariaLabel || '');
    return oldText === newText || oldText === '' || newText === '';
  });
  return matches[0] || null;
}

function wireBrowserEventCapture(page, browserEvents, log) {
  page.on('console', (message) => {
    const event = {
      kind: 'console',
      type: message.type(),
      text: redactForLog(message.text()),
      url: page.url(),
      location: message.location()
    };
    browserEvents.push(event);
    if (['error', 'warning'].includes(event.type)) {
      log(`Browser console ${event.type}: ${event.text}`);
    }
  });

  page.on('pageerror', (error) => {
    const event = {
      kind: 'pageerror',
      text: redactForLog(error.message),
      url: page.url()
    };
    browserEvents.push(event);
    log(`Browser page error: ${event.text}`);
  });

  page.on('requestfailed', (request) => {
    const event = {
      kind: 'requestfailed',
      method: request.method(),
      url: redactForLog(request.url()),
      failure: request.failure()?.errorText || 'request failed',
      pageUrl: page.url()
    };
    browserEvents.push(event);
    log(`Browser request failed: ${event.method} ${event.url} - ${event.failure}`);
  });
}

async function settlePage(page, config) {
  await page.waitForLoadState('networkidle', { timeout: Math.min(config.timeoutMs, 5000) }).catch(() => {});
  if (config.settleMs > 0) {
    await page.waitForTimeout(config.settleMs);
  }
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Playwright is not available in this checkout. Install the repo dependencies or run with an environment that provides playwright. Cause: ${detail}`
    );
  }
}

function routeToUrl(baseUrl, routePath) {
  return new URL(routePath, `${baseUrl}/`).href;
}

function parseViewport(input) {
  const match = /^(\d+)x(\d+)$/i.exec(input.trim());
  if (!match) throw new CliInputError(`Invalid --viewport, expected WIDTHxHEIGHT: ${input}`);
  return {
    width: parseBoundedInteger(match[1], '--viewport width', 320, 4096),
    height: parseBoundedInteger(match[2], '--viewport height', 240, 4096)
  };
}

function parseBoundedInteger(input, label, min, max) {
  const value = Number(input);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CliInputError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliInputError(`${flag} requires a value.`);
  }
  return value;
}

function resolvePath(pathText, cwd) {
  return isAbsolute(pathText) ? pathText : resolve(cwd, pathText);
}

function uniqueSlug(baseSlug, counts) {
  const count = counts.get(baseSlug) || 0;
  counts.set(baseSlug, count + 1);
  return count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function redactForLog(value) {
  return String(value || '')
    .replace(/(password|passwd|pwd|secret|sessionToken|token|api[_-]?key)=([^&\s]+)/gi, '$1=[REDACTED]')
    .replace(/("(?:password|passwd|pwd|secret|sessionToken|token|api[_-]?key)"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"');
}

function formatError(cause) {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

async function main(argv = process.argv.slice(2)) {
  let config;
  try {
    config = buildConfigFromArgs(argv);
  } catch (cause) {
    if (cause instanceof CliInputError) {
      console.error(cause.message);
      console.error('');
      console.error(usage());
      process.exitCode = 1;
      return;
    }
    throw cause;
  }

  if (config.help) {
    console.log(usage());
    return;
  }

  try {
    const manifest = await runSweep(config);
    if (!manifest.ok) process.exitCode = 2;
  } catch (cause) {
    console.error(formatError(cause));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
