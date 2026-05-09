import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('dashboard chatroom pins and composer drafts', () => {
  const sessionList = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/SessionList.svelte'),
    'utf8',
  );
  const sessionCard = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/SessionCard.svelte'),
    'utf8',
  );
  const chatMessages = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ChatMessages.svelte'),
    'utf8',
  );
  const messageInput = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/MessageInput.svelte'),
    'utf8',
  );

  it('passes the existing dashboard pin store through to standalone chatrooms', () => {
    expect(sessionList).toContain('pinnedToSidebar={sidebarPinnedIds.has(chat.id)}');
    expect(sessionList).toMatch(/onTogglePin=\{\(s(?:: any)?\) => toggleSidebarPin\(s\.id\)\}/);
    expect(sessionCard).toContain('Pin chatroom on dashboard');
    expect(sessionCard).toContain('aria-pressed={pinnedToSidebar}');
  });

  it('persists the main room composer draft by session id', () => {
    expect(chatMessages).toContain('draftKey={sessionId}');
    expect(messageInput).toContain('draftKey?: string | null');
    expect(messageInput).toContain('ant.chat.draft.');
    expect(messageInput).toContain('localStorage.setItem(storageKey, value)');
    expect(messageInput).toContain('localStorage.removeItem(storageKey)');
  });

  it('refreshes dashboard state when mobile Safari restores from bfcache', () => {
    expect(sessionList).toContain("window.addEventListener('pageshow', refreshDashboardAfterWake)");
    expect(sessionList).toContain("window.addEventListener('online', refreshDashboardAfterWake)");
    expect(sessionList).toContain("document.addEventListener('visibilitychange', handleVisibility)");
    expect(sessionList).toContain('void loadDashboardSessions({ force: true })');
    expect(sessionList).toMatch(/dashboardWs\.readyState === WebSocket\.CONNECTING[\s\S]*dashboardWs\.readyState === WebSocket\.OPEN/);
  });
});

describe('plan tests stay out of the live ANT database', () => {
  for (const filename of [
    'plan-projector.test.ts',
    'plan-live-api.test.ts',
    'plan-events-api.test.ts',
  ]) {
    it(`${filename} uses an isolated ANT_DATA_DIR`, () => {
      const source = readFileSync(resolve(import.meta.dirname, filename), 'utf8');
      expect(source).toContain('mkdtempSync');
      expect(source).toContain('process.env.ANT_DATA_DIR = dataDir');
      expect(source).toContain('_resetForTest()');
      expect(source).toContain('rmSync(dataDir, { recursive: true, force: true })');
    });
  }
});
