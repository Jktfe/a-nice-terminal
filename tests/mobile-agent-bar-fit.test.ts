import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('mobile agent bar and iPhone header fit', () => {
  const activityRail = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ActivityRail.svelte'),
    'utf8',
  );
  const chatHeader = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ChatHeader.svelte'),
    'utf8',
  );
  const shareButton = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ShareButton.svelte'),
    'utf8',
  );
  const chatMessages = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ChatMessages.svelte'),
    'utf8',
  );

  it('keeps the activity rail visible on phones without desktop status fanout', () => {
    expect(activityRail).not.toContain('if (isCompactPhoneRail()) return;');
    expect(activityRail).toContain('compactPhoneRail');
    expect(activityRail).toContain('if (compactPhoneRail)');
    expect(activityRail).toContain('needsInputMap = new Map()');
    expect(activityRail).toContain('width: calc(44px + var(--ant-safe-left, 0px))');
    expect(activityRail).toContain('.rail-tooltip');
    expect(activityRail).toContain('display: none');
  });

  it('bounds the chat header so iPhone Safari does not need pinch-to-fit', () => {
    expect(chatHeader).toContain('class="session-toolbar flex');
    expect(chatHeader).toContain('class="session-actions flex');
    expect(chatHeader).toContain('overflow-x: clip');
    expect(chatHeader).toContain('@media (max-width: 640px)');
    expect(chatHeader).toContain('min-width: 38px');
    expect(chatHeader).toContain('display: none !important');
  });

  it('makes the share control icon-first and sheet-width on mobile', () => {
    expect(shareButton).toContain('class="share-trigger touch-target');
    expect(shareButton).toContain('class="share-label"');
    expect(shareButton).toContain('.share-label');
    expect(shareButton).toContain('display: none');
    expect(shareButton).toContain('position: fixed');
    expect(shareButton).toContain('width: auto');
  });

  it('keeps the chat agent strip visible on mobile without status polling', () => {
    expect(chatMessages).toContain("session?.type === 'terminal' ? [] : statusParticipants");
    expect(chatMessages).not.toContain("session?.type === 'terminal' || !statusPollingEnabled ? []");
    expect(chatMessages).toContain('class="agent-status-strip');
    expect(chatMessages).toContain('.agent-status-chip span:nth-child(3)');
  });
});
