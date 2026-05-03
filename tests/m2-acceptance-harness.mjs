#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require('playwright');

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const defaultEvidencePath = path.join(repoRoot, 'docs', 'm2-acceptance-evidence.md');

const args = parseArgs(process.argv.slice(2));
const lineCount = Number(args['line-count'] ?? 100_000);
const refreshRounds = Number(args['refresh-rounds'] ?? 16);
const activationOrder = String(args['activation-order'] ?? 'current');
const outputPath = path.resolve(repoRoot, String(args.output ?? defaultEvidencePath));
const selectedTargets = String(args.targets ?? 'desktop-chromium,desktop-webkit,mobile-chromium,mobile-webkit')
  .split(',')
  .map((target) => target.trim())
  .filter(Boolean);

const nodeModulesRoot = findNodeModulesRoot();

const targetMatrix = [
  {
    name: 'desktop-chromium',
    engine: 'chromium',
    browserType: chromium,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    terminalSize: { width: 1040, height: 560 },
  },
  {
    name: 'desktop-webkit',
    engine: 'webkit',
    browserType: webkit,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    terminalSize: { width: 1040, height: 560 },
  },
  {
    name: 'mobile-chromium',
    engine: 'chromium',
    browserType: chromium,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    terminalSize: { width: 362, height: 620 },
  },
  {
    name: 'mobile-webkit',
    engine: 'webkit',
    browserType: webkit,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    terminalSize: { width: 362, height: 620 },
  },
].filter((target) => selectedTargets.includes(target.name));

if (targetMatrix.length === 0) {
  throw new Error(`No target matched --targets=${selectedTargets.join(',')}`);
}

const results = [];
let server;

try {
  server = await startHarnessServer();
  for (const target of targetMatrix) {
    console.log(`m2 harness: ${target.name}`);
    results.push(await runTarget(server.url, target));
  }

  const evidence = await renderEvidence(results);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, evidence);
  console.log(`m2 harness: wrote ${path.relative(repoRoot, outputPath)}`);

  const allPass = results.every((result) => result.pass);
  process.exitCode = allPass ? 0 : 1;
} finally {
  await server?.close();
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value = 'true'] = arg.slice(2).split('=');
    parsed[key] = value;
  }
  return parsed;
}

function findNodeModulesRoot() {
  const candidates = [
    path.join(repoRoot, 'node_modules'),
    path.join(repoRoot, '..', 'a-nice-terminal', 'node_modules'),
    path.join(repoRoot, '..', 'node_modules'),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, '@xterm', 'xterm', 'lib', 'xterm.mjs'))) {
      return candidate;
    }
  }

  throw new Error('Unable to find @xterm/xterm in node_modules. Run npm install before the M2 harness.');
}

async function startHarnessServer() {
  const html = renderHarnessHtml();
  const serverInstance = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (requestUrl.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      if (!requestUrl.pathname.startsWith('/node_modules/')) {
        res.writeHead(404);
        res.end('not found');
        return;
      }

      const relativePath = decodeURIComponent(requestUrl.pathname.replace(/^\/node_modules\//, ''));
      const filePath = path.resolve(nodeModulesRoot, relativePath);
      if (!filePath.startsWith(nodeModulesRoot + path.sep)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }

      const body = await fs.readFile(filePath);
      res.writeHead(200, { 'content-type': contentTypeFor(filePath) });
      res.end(body);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error?.stack ?? error));
    }
  });

  await new Promise((resolve) => serverInstance.listen(0, '127.0.0.1', resolve));
  const address = serverInstance.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => serverInstance.close(resolve)),
  };
}

function contentTypeFor(filePath) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.mjs') || filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.map')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function runTarget(url, target) {
  let browser;
  let browserVersion = 'unavailable';
  const consoleMessages = [];
  try {
    browser = await target.browserType.launch({
      headless: true,
      args: target.engine === 'chromium' ? ['--enable-webgl', '--ignore-gpu-blocklist'] : [],
    });
    browserVersion = browser.version();
    const dom = await runRendererCase(browser, url, target, 'dom', consoleMessages);
    const webgl = await runRendererCase(browser, url, target, 'webgl', consoleMessages);
    const pixel = {
      firstPaint: diffPng(dom.firstPaintPng, webgl.firstPaintPng),
      final: diffPng(dom.finalPng, webgl.finalPng),
    };
    const semanticRowsEqual = hashLines(dom.burst.visibleRows) === hashLines(webgl.burst.visibleRows);
    const refreshSpeedup = safeRatio(dom.burst.refreshMedianMs, webgl.burst.refreshMedianMs);
    const webglStable = webgl.setup.rendererStatus === 'webgl' && webgl.setup.contextLosses === 0 && webgl.burst.contextLosses === 0;
    const pass =
      webglStable &&
      semanticRowsEqual &&
      pixel.firstPaint.diffPercent <= 0.5 &&
      pixel.final.diffPercent <= 0.5 &&
      refreshSpeedup >= 5 &&
      webgl.burst.refreshLongTasks.length === 0;

    return {
      name: target.name,
      engine: target.engine,
      browserVersion,
      viewport: target.viewport,
      deviceScaleFactor: target.deviceScaleFactor,
      terminalSize: target.terminalSize,
      pass,
      dom,
      webgl,
      pixel,
      semanticRowsEqual,
      refreshSpeedup,
      webglStable,
      consoleMessages,
    };
  } catch (error) {
    return {
      name: target.name,
      engine: target.engine,
      browserVersion,
      viewport: target.viewport,
      deviceScaleFactor: target.deviceScaleFactor,
      terminalSize: target.terminalSize,
      pass: false,
      error: String(error?.stack ?? error),
      consoleMessages,
    };
  } finally {
    await browser?.close();
  }
}

async function runRendererCase(browser, url, target, renderer, consoleMessages) {
  const context = await browser.newContext({
    viewport: target.viewport,
    deviceScaleFactor: target.deviceScaleFactor,
    isMobile: target.isMobile,
    hasTouch: target.hasTouch,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(0);
  page.on('console', (message) => {
    consoleMessages.push(`[${target.name}/${renderer}] ${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    consoleMessages.push(`[${target.name}/${renderer}] pageerror: ${error.message}`);
  });

  try {
    await page.goto(url);
    const setup = await page.evaluate((input) => window.setupM2Terminal(input), {
      renderer,
      activationOrder,
      terminalSize: target.terminalSize,
      lineCount,
    });
    const firstPaintPng = await page.locator('#terminal').screenshot({ animations: 'disabled' });

    const cdpSession = await createChromiumMetricsSession(page, target.engine);
    const cdpBefore = await readChromiumMetrics(cdpSession);
    const burst = await page.evaluate((input) => window.runM2Burst(input), {
      lineCount,
      refreshRounds,
    });
    const cdpAfter = await readChromiumMetrics(cdpSession);
    await cdpSession?.detach();
    const finalPng = await page.locator('#terminal').screenshot({ animations: 'disabled' });

    return {
      setup,
      burst: {
        ...burst,
        cdpScriptDurationMs:
          cdpBefore && cdpAfter ? Math.max(0, cdpAfter.ScriptDuration - cdpBefore.ScriptDuration) * 1000 : null,
      },
      firstPaintPng,
      finalPng,
    };
  } finally {
    await context.close();
  }
}

async function createChromiumMetricsSession(page, engine) {
  if (engine !== 'chromium') return null;
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    return session;
  } catch {
    return null;
  }
}

async function readChromiumMetrics(session) {
  if (!session) return null;
  try {
    const { metrics } = await session.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
  } catch {
    return null;
  }
}

function renderHarnessHtml() {
  return String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/node_modules/@xterm/xterm/css/xterm.css">
    <style>
      :root {
        color-scheme: dark;
        background: #0a0f14;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
        background: #0a0f14;
      }

      body {
        display: grid;
        place-items: center;
        overflow: hidden;
      }

      #terminal {
        background: #05080c;
        overflow: hidden;
      }

      .xterm {
        height: 100%;
        padding: 0;
      }

      .xterm-viewport {
        scrollbar-width: none;
      }

      .xterm-viewport::-webkit-scrollbar {
        display: none;
      }

      .xterm-cursor,
      .xterm-cursor-layer {
        opacity: 0 !important;
        visibility: hidden !important;
      }
    </style>
  </head>
  <body>
    <div id="terminal"></div>
    <script type="module">
      import { Terminal } from '/node_modules/@xterm/xterm/lib/xterm.mjs';
      import { FitAddon } from '/node_modules/@xterm/addon-fit/lib/addon-fit.mjs';
      import { WebglAddon } from '/node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs';

      const sentinel = 'ANT M2 glyph sentinel: 0123456789 ABCD efgh @handle box ─│┌┐└┘ ✓ £ € # raw bytes stay text';

      window.setupM2Terminal = async ({ renderer, activationOrder, terminalSize, lineCount }) => {
        const terminalElement = document.querySelector('#terminal');
        terminalElement.replaceChildren();
        terminalElement.style.width = terminalSize.width + 'px';
        terminalElement.style.height = terminalSize.height + 'px';

        const term = new Terminal({
          allowProposedApi: true,
          convertEol: true,
          cursorBlink: false,
          disableStdin: true,
          fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
          fontSize: 14,
          lineHeight: 1.2,
          scrollback: lineCount + 200,
          theme: {
            background: '#05080c',
            foreground: '#dce7ef',
            cursor: '#05080c',
            selectionBackground: '#2f5f7a',
          },
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalElement);

        const state = {
          term,
          fitAddon,
          webglAddon: null,
          contextLosses: 0,
          fallbackReason: null,
          rendererRequested: renderer,
        };

        terminalElement.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault();
            state.contextLosses += 1;
            state.fallbackReason = 'webglcontextlost';
          },
          true,
        );

        await document.fonts.ready;
        await settleFrames(2);

        if (renderer === 'webgl' && activationOrder === 'current') {
          activateWebgl(term, state);
        }

        fitAddon.fit();

        if (renderer === 'webgl' && activationOrder !== 'current') {
          activateWebgl(term, state);
          fitAddon.fit();
        }

        await writeAsync(term, sentinel + '\r\n');
        await settleFrames(3);

        window.__m2Terminal = state;

        return {
          rendererRequested: renderer,
          rendererStatus: rendererStatus(state),
          activationOrder,
          fontReady: true,
          contextLosses: state.contextLosses,
          fallbackReason: state.fallbackReason,
          cols: term.cols,
          rows: term.rows,
          terminalSize,
          firstPaintRows: visibleRows(term),
          canvasCount: terminalElement.querySelectorAll('canvas').length,
        };
      };

      window.runM2Burst = async ({ lineCount, refreshRounds }) => {
        const state = window.__m2Terminal;
        const term = state.term;
        const burst = buildBurst(lineCount);
        const writeStart = performance.now();
        await writeAsync(term, burst);
        await settleFrames(4);
        const writeEnd = performance.now();

        term.scrollToBottom();
        await settleFrames(2);

        const refreshCollector = makeLongTaskCollector();
        const refreshSamples = [];
        for (let i = 0; i < refreshRounds; i += 1) {
          const start = performance.now();
          term.refresh(0, term.rows - 1);
          await nextFrame();
          refreshSamples.push(performance.now() - start);
        }
        const refreshLongTasks = refreshCollector.stop();

        const scrollCollector = makeLongTaskCollector();
        const scrollSamples = [];
        const maxLine = Math.max(0, term.buffer.active.length - term.rows);
        for (let i = 0; i < refreshRounds; i += 1) {
          const line = Math.round((maxLine * i) / Math.max(1, refreshRounds - 1));
          const start = performance.now();
          term.scrollToLine(line);
          await nextFrame();
          scrollSamples.push(performance.now() - start);
        }
        const scrollLongTasks = scrollCollector.stop();
        term.scrollToBottom();
        await settleFrames(2);

        return {
          rendererStatus: rendererStatus(state),
          contextLosses: state.contextLosses,
          fallbackReason: state.fallbackReason,
          lineCount,
          cols: term.cols,
          rows: term.rows,
          writeMs: writeEnd - writeStart,
          refreshMedianMs: median(refreshSamples),
          refreshMaxMs: Math.max(...refreshSamples),
          refreshLongTasks,
          scrollMedianMs: median(scrollSamples),
          scrollMaxMs: Math.max(...scrollSamples),
          scrollLongTasks,
          visibleRows: visibleRows(term),
        };
      };

      function activateWebgl(term, state) {
        try {
          const addon = new WebglAddon(true);
          addon.onContextLoss(() => {
            state.contextLosses += 1;
            state.fallbackReason = 'contextlost';
          });
          term.loadAddon(addon);
          state.webglAddon = addon;
        } catch (error) {
          state.fallbackReason = error instanceof Error ? error.message : String(error);
        }
      }

      function rendererStatus(state) {
        if (state.rendererRequested !== 'webgl') return 'dom';
        return state.webglAddon && state.contextLosses === 0 ? 'webgl' : 'dom';
      }

      function writeAsync(term, data) {
        return new Promise((resolve) => term.write(data, resolve));
      }

      function buildBurst(lineCount) {
        const lines = new Array(lineCount);
        for (let i = 0; i < lineCount; i += 1) {
          const color = 16 + (i % 216);
          lines[i] =
            '\x1b[38;5;' +
            color +
            'mM2 ' +
            String(i).padStart(6, '0') +
            '\x1b[0m renderer acceptance burst abcdefghijklmnopqrstuvwxyz 0123456789';
        }
        return lines.join('\r\n') + '\r\n';
      }

      function visibleRows(term) {
        const rows = [];
        const buffer = term.buffer.active;
        const start = buffer.viewportY;
        for (let row = 0; row < term.rows; row += 1) {
          rows.push(buffer.getLine(start + row)?.translateToString(true) ?? '');
        }
        return rows;
      }

      function makeLongTaskCollector() {
        const entries = [];
        let observer = null;
        if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
          observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              entries.push({ startTime: entry.startTime, duration: entry.duration });
            }
          });
          observer.observe({ type: 'longtask', buffered: false });
        }
        return {
          stop() {
            observer?.disconnect();
            return entries;
          },
        };
      }

      function median(values) {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)] ?? 0;
      }

      function nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }

      async function settleFrames(count) {
        for (let i = 0; i < count; i += 1) {
          await nextFrame();
        }
      }
    </script>
  </body>
</html>`;
}

function diffPng(leftBuffer, rightBuffer) {
  const left = decodePng(leftBuffer);
  const right = decodePng(rightBuffer);
  const width = Math.min(left.width, right.width);
  const height = Math.min(left.height, right.height);
  let compared = 0;
  let different = 0;
  let totalDelta = 0;
  let maxDelta = 0;
  const threshold = 24;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const leftIndex = (y * left.width + x) * 4;
      const rightIndex = (y * right.width + x) * 4;
      const dr = Math.abs(left.data[leftIndex] - right.data[rightIndex]);
      const dg = Math.abs(left.data[leftIndex + 1] - right.data[rightIndex + 1]);
      const db = Math.abs(left.data[leftIndex + 2] - right.data[rightIndex + 2]);
      const da = Math.abs(left.data[leftIndex + 3] - right.data[rightIndex + 3]);
      const delta = Math.max(dr, dg, db, da);
      compared += 1;
      totalDelta += delta;
      maxDelta = Math.max(maxDelta, delta);
      if (delta > threshold) different += 1;
    }
  }

  return {
    width,
    height,
    threshold,
    different,
    compared,
    diffPercent: (different / compared) * 100,
    meanDelta: totalDelta / compared,
    maxDelta,
  };
}

function decodePng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error('Invalid PNG signature');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
        throw new Error(`Unsupported PNG format bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
      }
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const rgba = Buffer.alloc(width * height * 4);
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const scanline = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    unfilterScanline(scanline, previous, channels, filter);

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      rgba[target] = scanline[source];
      rgba[target + 1] = scanline[source + 1];
      rgba[target + 2] = scanline[source + 2];
      rgba[target + 3] = channels === 4 ? scanline[source + 3] : 255;
    }

    previous = scanline;
  }

  return { width, height, data: rgba };
}

function unfilterScanline(scanline, previous, bytesPerPixel, filter) {
  for (let i = 0; i < scanline.length; i += 1) {
    const left = i >= bytesPerPixel ? scanline[i - bytesPerPixel] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
    if (filter === 1) {
      scanline[i] = (scanline[i] + left) & 0xff;
    } else if (filter === 2) {
      scanline[i] = (scanline[i] + up) & 0xff;
    } else if (filter === 3) {
      scanline[i] = (scanline[i] + Math.floor((left + up) / 2)) & 0xff;
    } else if (filter === 4) {
      scanline[i] = (scanline[i] + paeth(left, up, upLeft)) & 0xff;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter ${filter}`);
    }
  }
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function safeRatio(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= 0) return 0;
  return left / right;
}

function hashLines(lines) {
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

async function renderEvidence(runResults) {
  const gitCommit = await commandOutput('git', ['rev-parse', '--short', 'HEAD']);
  const gitBranch = await commandOutput('git', ['branch', '--show-current']);
  const generatedAt = new Date().toISOString();
  const overallPass = runResults.every((result) => result.pass);
  const command = [
    'node tests/m2-acceptance-harness.mjs',
    `--line-count=${lineCount}`,
    `--refresh-rounds=${refreshRounds}`,
    `--activation-order=${activationOrder}`,
  ].join(' ');

  const lines = [
    '# M2 WebGL Acceptance Evidence',
    '',
    `Generated: ${generatedAt}`,
    `Branch: ${gitBranch}`,
    `Commit: ${gitCommit}`,
    `Command: \`${command}\``,
    '',
    `Overall result: **${overallPass ? 'PASS' : 'FAIL'}**`,
    '',
    `Scope: this harness isolates renderer-relevant browser work. It writes the same ${lineCount.toLocaleString('en-GB')}-line xterm buffer into DOM and WebGL terminals inside the browser, then measures viewport refresh after identical buffer content. It does not include CLI, WebSocket, PTY, tmux, or server replay time.`,
    '',
    'Acceptance rules checked: WebGL remained active with no context loss, no refresh long tasks, renderer refresh was at least 5x faster than DOM, first-paint and final terminal-surface pixel diff stayed under 0.5%, and visible terminal rows were semantically identical.',
    '',
    '| Target | Browser | WebGL stable | Refresh DOM ms | Refresh WebGL ms | Speedup | Refresh stalls | First-paint diff | Final diff | Semantic rows | Result |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ];

  for (const result of runResults) {
    if (result.error) {
      lines.push(
        `| ${result.name} | ${result.browserVersion ?? result.engine} | no | n/a | n/a | n/a | n/a | n/a | n/a | n/a | FAIL |`,
      );
      continue;
    }
    lines.push(
      [
        `| ${result.name}`,
        result.browserVersion,
        result.webglStable ? 'yes' : 'no',
        formatNumber(result.dom.burst.refreshMedianMs),
        formatNumber(result.webgl.burst.refreshMedianMs),
        `${formatNumber(result.refreshSpeedup)}x`,
        String(result.webgl.burst.refreshLongTasks.length),
        `${formatNumber(result.pixel.firstPaint.diffPercent)}%`,
        `${formatNumber(result.pixel.final.diffPercent)}%`,
        result.semanticRowsEqual ? 'yes' : 'no',
        result.pass ? 'PASS |' : 'FAIL |',
      ].join(' | '),
    );
  }

  lines.push('', '## Detailed Results', '');

  for (const result of runResults) {
    lines.push(`### ${result.name}`, '');
    lines.push(`Engine: ${result.engine}`);
    lines.push(`Browser version: ${result.browserVersion ?? 'n/a'}`);
    lines.push(`Viewport: ${result.viewport.width}x${result.viewport.height} @${result.deviceScaleFactor}x`);
    lines.push(`Terminal crop: ${result.terminalSize.width}x${result.terminalSize.height}`);
    lines.push('');

    if (result.error) {
      lines.push('Result: **FAIL**', '', '```text', result.error, '```', '');
      continue;
    }

    lines.push(`Result: **${result.pass ? 'PASS' : 'FAIL'}**`);
    lines.push(`DOM write: ${formatNumber(result.dom.burst.writeMs)} ms`);
    lines.push(`WebGL write: ${formatNumber(result.webgl.burst.writeMs)} ms`);
    if (result.dom.burst.cdpScriptDurationMs !== null || result.webgl.burst.cdpScriptDurationMs !== null) {
      lines.push(`DOM CDP ScriptDuration: ${formatNullable(result.dom.burst.cdpScriptDurationMs)} ms`);
      lines.push(`WebGL CDP ScriptDuration: ${formatNullable(result.webgl.burst.cdpScriptDurationMs)} ms`);
    }
    lines.push(`DOM refresh median/max: ${formatNumber(result.dom.burst.refreshMedianMs)} / ${formatNumber(result.dom.burst.refreshMaxMs)} ms`);
    lines.push(`WebGL refresh median/max: ${formatNumber(result.webgl.burst.refreshMedianMs)} / ${formatNumber(result.webgl.burst.refreshMaxMs)} ms`);
    lines.push(`DOM scroll median/max: ${formatNumber(result.dom.burst.scrollMedianMs)} / ${formatNumber(result.dom.burst.scrollMaxMs)} ms`);
    lines.push(`WebGL scroll median/max: ${formatNumber(result.webgl.burst.scrollMedianMs)} / ${formatNumber(result.webgl.burst.scrollMaxMs)} ms`);
    lines.push(`WebGL context losses: setup=${result.webgl.setup.contextLosses}, burst=${result.webgl.burst.contextLosses}`);
    lines.push(`WebGL fallback reason: ${result.webgl.burst.fallbackReason ?? 'none'}`);
    lines.push(
      `First-paint diff: ${formatNumber(result.pixel.firstPaint.diffPercent)}% (${result.pixel.firstPaint.different}/${result.pixel.firstPaint.compared}, threshold ${result.pixel.firstPaint.threshold})`,
    );
    lines.push(
      `Final diff: ${formatNumber(result.pixel.final.diffPercent)}% (${result.pixel.final.different}/${result.pixel.final.compared}, threshold ${result.pixel.final.threshold})`,
    );
    lines.push(`Visible rows hash DOM: ${hashLines(result.dom.burst.visibleRows)}`);
    lines.push(`Visible rows hash WebGL: ${hashLines(result.webgl.burst.visibleRows)}`);
    lines.push(`Console messages: ${result.consoleMessages.length}`);
    if (result.consoleMessages.length > 0) {
      lines.push('', '```text', ...result.consoleMessages.slice(0, 20), '```');
    }
    lines.push('');
  }

  lines.push(
    '## Notes',
    '',
    '- Desktop Safari and mobile Safari are represented by Playwright WebKit in this local harness.',
    '- Pixel comparison uses a terminal-only crop with cursor hidden. A pixel is counted as different when any RGBA channel delta exceeds 24.',
    '- The full 100k-line `term.write` timing is recorded for diagnosis, but the 5x acceptance metric uses refresh timing after both renderers already contain identical buffer input.',
    '',
  );

  return lines.join('\n');
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return value.toFixed(2);
}

function formatNullable(value) {
  return value === null ? 'n/a' : formatNumber(value);
}

async function commandOutput(command, argv) {
  const { spawn } = await import('node:child_process');
  return await new Promise((resolve) => {
    const child = spawn(command, argv, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', () => resolve(output.trim()));
    child.on('error', () => resolve('unknown'));
  });
}
