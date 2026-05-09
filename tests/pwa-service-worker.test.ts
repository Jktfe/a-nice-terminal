import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('PWA service worker freshness', () => {
  const sw = readFileSync(resolve(import.meta.dirname, '../static/sw.js'), 'utf8');
  const layout = readFileSync(resolve(import.meta.dirname, '../src/routes/+layout.svelte'), 'utf8');

  it('never serves navigation or API calls from cache', () => {
    expect(sw).toContain("const CACHE_NAME = 'ant-v3-cache-v3'");
    expect(sw).toContain("url.pathname.startsWith('/api/')");
    expect(sw).toContain('if (isNavigationRequest(request))');
    expect(sw).toContain('fetch(request).catch');
  });

  it('actively updates old installed workers instead of waiting for Safari cache checks', () => {
    expect(sw).toContain("event.data?.type === 'SKIP_WAITING'");
    expect(layout).toContain("register('/sw.js', { updateViaCache: 'none' })");
    expect(layout).toContain('void reg.update()');
    expect(layout).toContain("reg.waiting.postMessage({ type: 'SKIP_WAITING' })");
    expect(layout).toContain("navigator.serviceWorker.addEventListener('controllerchange'");
  });
});
