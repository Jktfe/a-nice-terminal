#!/usr/bin/env node
/**
 * M6 #1 — Visual QA capture-coverage scripted exercise
 * Drives the app through 6 known states and captures a screenshot + baseline JSON.
 *
 * Prerequisites:
 *   npm run dev &  # start the app first
 *
 * Usage:
 *   node scripts/visual-qa-capture.mjs --base-url http://localhost:5173 --out-dir .ant-v3/evidence/visual-qa
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

function parseArgs(argv) {
  const args = { baseUrl: 'http://localhost:5173', outDir: '.ant-v3/evidence/visual-qa' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--base-url' && argv[i + 1]) { args.baseUrl = argv[i + 1]; i++; }
    if (argv[i] === '--out-dir' && argv[i + 1]) { args.outDir = argv[i + 1]; i++; }
  }
  return args;
}

async function apiPost(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API POST ${path} failed: ${res.status}`);
  return res.json();
}

async function capturePage(page, name, outDir) {
  await page.waitForTimeout(500);
  const screenshotPath = join(outDir, `${name}.png`);
  const buffer = await page.screenshot({ path: screenshotPath, fullPage: false });
  return {
    name,
    screenshot: screenshotPath,
    bytes: buffer.length,
    timestamp: Date.now(),
  };
}

async function main() {
  const { baseUrl, outDir } = parseArgs(process.argv);
  mkdirSync(outDir, { recursive: true });

  console.log('Visual QA capture starting…');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Output dir: ${outDir}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const results = [];

  // ── 1. chat empty ──
  {
    const chat = await apiPost(baseUrl, '/api/sessions', { name: 'Visual QA Chat Empty', type: 'chat', ttl: '15m' });
    await page.goto(`${baseUrl}/session/${chat.id}`, { waitUntil: 'networkidle' });
    results.push(await capturePage(page, 'chat-empty', outDir));
  }

  // ── 2. chat busy ──
  {
    const chat = await apiPost(baseUrl, '/api/sessions', { name: 'Visual QA Chat Busy', type: 'chat', ttl: '15m' });
    await apiPost(baseUrl, `/api/sessions/${chat.id}/messages`, {
      role: 'user', content: 'Hello from visual QA', format: 'text', msg_type: 'message',
    });
    await apiPost(baseUrl, `/api/sessions/${chat.id}/messages`, {
      role: 'assistant', content: 'Acknowledged. Here is a longer response to make the chat look busy.', format: 'text', msg_type: 'message',
    });
    await page.goto(`${baseUrl}/session/${chat.id}`, { waitUntil: 'networkidle' });
    results.push(await capturePage(page, 'chat-busy', outDir));
  }

  // ── 3. terminal idle ──
  {
    const term = await apiPost(baseUrl, '/api/sessions', { name: 'Visual QA Terminal Idle', type: 'terminal', ttl: 'forever' });
    await page.goto(`${baseUrl}/session/${term.id}`, { waitUntil: 'networkidle' });
    results.push(await capturePage(page, 'terminal-idle', outDir));
  }

  // ── 4. terminal running ──
  {
    const term = await apiPost(baseUrl, '/api/sessions', { name: 'Visual QA Terminal Running', type: 'terminal', ttl: 'forever' });
    await page.goto(`${baseUrl}/session/${term.id}`, { waitUntil: 'networkidle' });
    // Type a command in the terminal
    const input = await page.$('input, textarea');
    if (input) {
      await input.fill('echo "Visual QA running state"');
      await input.press('Enter');
      await page.waitForTimeout(800);
    }
    results.push(await capturePage(page, 'terminal-running', outDir));
  }

  // ── 5. asks-sidebar populated ──
  {
    // Create a room with some asks
    const room = await apiPost(baseUrl, '/api/sessions', { name: 'Visual QA Asks Room', type: 'chat', ttl: '15m' });
    await apiPost(baseUrl, `/api/sessions/${room.id}/messages`, {
      role: 'user', content: 'ask: What is the status of the deployment?', format: 'text', msg_type: 'ask',
    });
    await apiPost(baseUrl, `/api/sessions/${room.id}/messages`, {
      role: 'user', content: 'ask: Review the consent grant schema', format: 'text', msg_type: 'ask',
    });
    await page.goto(`${baseUrl}/session/${room.id}`, { waitUntil: 'networkidle' });
    // Open the asks sidebar if there's a button for it
    const askBtn = await page.$('button:has-text("Asks")');
    if (askBtn) await askBtn.click();
    await page.waitForTimeout(300);
    results.push(await capturePage(page, 'asks-sidebar', outDir));
  }

  // ── 6. focus-mode toast ──
  {
    const room = await apiPost(baseUrl, '/api/sessions', { name: 'Visual QA Focus Room', type: 'chat', ttl: '15m' });
    // Create a participant to set focus on
    const participant = await apiPost(baseUrl, '/api/sessions', { name: 'Focus Participant', type: 'terminal', ttl: 'forever' });
    await apiPost(baseUrl, `/api/sessions/${room.id}/participants`, {
      session_id: participant.id, role: 'participant',
    });
    // Set focus via PATCH
    const patchRes = await fetch(`${baseUrl}/api/sessions/${room.id}/participants`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: participant.id,
        attention_state: 'focus',
        reason: 'Visual QA focus mode',
        ttl: '5m',
        set_by: participant.id,
      }),
    });
    if (!patchRes.ok) throw new Error(`Focus PATCH failed: ${patchRes.status}`);
    await page.goto(`${baseUrl}/session/${room.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    results.push(await capturePage(page, 'focus-mode-toast', outDir));
  }

  await browser.close();

  const baseline = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    viewport: { width: 1280, height: 800 },
    states: results,
  };

  const baselinePath = join(outDir, 'baseline.json');
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));

  console.log(`\nCaptured ${results.length} states:`);
  for (const r of results) {
    console.log(`  ${r.name} — ${r.screenshot} (${r.bytes} bytes)`);
  }
  console.log(`\nBaseline written to ${baselinePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
