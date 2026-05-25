/**
 * Adapter tests for Bring-in-App web v0.
 *
 * Cover the pure-function surface: prompt building from the payload, and
 * adapter-table shape. The actual `launch()` paths (DOM iframe + clipboard)
 * are JSDOM-fragile and would be covered by a playwright pass when v0.5
 * adds a second adapter — keeping these tests focused on the contract.
 */

import { describe, expect, test } from 'vitest';
import {
  BRING_IN_APP_ADAPTERS,
  findAdapter,
  _buildClaudeDesktopPromptForTests as buildPrompt
} from './adapters';
import type { RoomContextPayload } from './types';

const samplePayload: RoomContextPayload = {
  roomId: 'orsz2321qb',
  roomName: 'Speed Matters',
  roomDescription: 'Overnight delivery sprint',
  recentMessagesMarkdown: '- @speedyclaude: shipped\n- @speedycodex: peer-ACK',
  openAsksMarkdown: '- ask_1: confirm next pick',
  generatedAtMs: 1716636000000
};

describe('buildClaudeDesktopPrompt', () => {
  test('includes the room name and signature trailing prompt', () => {
    const prompt = buildPrompt(samplePayload);
    expect(prompt).toContain('"Speed Matters"');
    expect(prompt).toContain('Please help me think about this.');
  });

  test('includes description when present', () => {
    const prompt = buildPrompt(samplePayload);
    expect(prompt).toContain('Overnight delivery sprint');
  });

  test('omits description section when null', () => {
    const prompt = buildPrompt({ ...samplePayload, roomDescription: null });
    expect(prompt).not.toContain('Room context:');
  });

  test('omits open-asks section when null', () => {
    const prompt = buildPrompt({ ...samplePayload, openAsksMarkdown: null });
    expect(prompt).not.toContain('Open asks');
  });

  test('omits recent-messages section when empty', () => {
    const prompt = buildPrompt({ ...samplePayload, recentMessagesMarkdown: '' });
    expect(prompt).not.toContain('Recent conversation:');
  });

  test('sections are blank-line separated for readability', () => {
    const prompt = buildPrompt(samplePayload);
    expect(prompt.includes('\n\n')).toBe(true);
  });
});

describe('BRING_IN_APP_ADAPTERS', () => {
  test('exposes exactly the five v0 targets', () => {
    const targets = BRING_IN_APP_ADAPTERS.map((a) => a.target).sort();
    expect(targets).toEqual([
      'chatgpt',
      'claude-desktop',
      'claude-mobile',
      'codex-desktop',
      'gemini'
    ]);
  });

  test('Claude Desktop is the only v0-available adapter', () => {
    const available = BRING_IN_APP_ADAPTERS.filter((a) => a.available);
    expect(available.map((a) => a.target)).toEqual(['claude-desktop']);
  });

  test('every unavailable adapter carries a user-visible reason', () => {
    for (const adapter of BRING_IN_APP_ADAPTERS) {
      if (!adapter.available) {
        expect(adapter.unavailableReason).toBeTruthy();
      }
    }
  });

  test('findAdapter looks up by target', () => {
    const adapter = findAdapter('claude-desktop');
    expect(adapter?.label).toBe('Bring in Claude Desktop');
    expect(findAdapter('chatgpt')?.available).toBe(false);
  });
});
