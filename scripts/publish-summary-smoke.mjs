import { chromium } from 'playwright';

async function apiPost(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API POST ${path} failed: ${res.status}`);
  return res.json();
}

async function main() {
  const baseUrl = 'http://localhost:5173';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const room = await apiPost(baseUrl, '/api/sessions', { name: 'Smoke Room', type: 'chat', ttl: '15m' });
  const terminal = await apiPost(baseUrl, '/api/sessions', { name: 'Smoke Terminal', type: 'terminal', ttl: 'forever' });

  const interviewRes = await fetch(`${baseUrl}/api/sessions/${terminal.id}/start-interview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin_room_id: room.id, caller_handle: '@smoke' }),
  });
  const interview = await interviewRes.json();
  console.log('Interview:', interview);

  await page.goto(`${baseUrl}/session/${terminal.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const panelBtn = await page.$('button[aria-label="Open side panel"]');
  if (panelBtn) await panelBtn.click();
  await page.waitForTimeout(500);

  const publishBtn = await page.$('button:has-text("Publish Summary")');
  if (publishBtn) {
    console.log('✅ Publish Summary button found');
    // Try clicking it
    await publishBtn.click();
    await page.waitForTimeout(1000);
    console.log('✅ Publish Summary button clicked');
  } else {
    console.log('❌ Publish Summary button NOT found');
  }

  await browser.close();
}

main().catch(console.error);
