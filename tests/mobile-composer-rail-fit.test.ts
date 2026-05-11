import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('mobile composer and expandable rail fit', () => {
  const messageInput = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/MessageInput.svelte'),
    'utf8',
  );
  const breakConfirmModal = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/BreakConfirmModal.svelte'),
    'utf8',
  );
  const chatMessages = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ChatMessages.svelte'),
    'utf8',
  );
  const activityRail = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ActivityRail.svelte'),
    'utf8',
  );

  it('gives the mobile composer a full-width 16px textarea and keyboard transform', () => {
    expect(messageInput).toContain('class="composer-shell flex');
    expect(messageInput).toContain('grid-template-areas:');
    expect(messageInput).toContain('"input input input"');
    expect(messageInput).toContain('font-size: 16px !important');
    expect(messageInput).toContain('transform: translateY(calc(-1 * var(--ant-keyboard-h, 0px)))');
    expect(messageInput).toContain('keepComposerVisible()');
    expect(messageInput).toContain("scrollIntoView({ block: 'nearest', behavior: 'smooth' })");
  });

  it('uses an in-app break confirmation modal instead of native confirm on mobile', () => {
    expect(messageInput).not.toContain('window.confirm');
    expect(messageInput).toContain('BreakConfirmModal');
    expect(messageInput).toContain('breakModalOpen');
    expect(breakConfirmModal).toContain('role="dialog"');
    expect(breakConfirmModal).toContain('Post a context break?');
    expect(breakConfirmModal).toContain('@media (max-width: 640px)');
  });

  it('keeps terminal linked-chat composers readable on mobile too', () => {
    expect(chatMessages).toContain('.linked-composer-shell textarea');
    expect(chatMessages).toContain('font-size: 16px');
    expect(chatMessages).toContain('grid-template-areas:');
    expect(chatMessages).toContain('"input input"');
    expect(chatMessages).toContain('transform: translateY(calc(-1 * var(--ant-keyboard-h, 0px)))');
  });

  it('lets the compact activity rail expand to show labels without status fanout', () => {
    expect(activityRail).toContain('compactRailExpanded');
    expect(activityRail).toContain('MOBILE_RAIL_EXPANDED_KEY');
    expect(activityRail).toContain('class="rail-expand-toggle"');
    expect(activityRail).toContain('class="rail-label"');
    expect(activityRail).toContain('.activity-rail.compact-expanded');
    expect(activityRail).toContain('needsInputMap = new Map()');
  });
});
