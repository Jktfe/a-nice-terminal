/**
 * Adapter tests for Bring-in-App web v0.5.
 *
 * Cover the pure-function surface: prompt building from the payload, and
 * adapter-table shape. The actual `launch()` paths (DOM iframe + clipboard)
 * are JSDOM-fragile and would be covered by a playwright pass when v1
 * adds a third adapter — keeping these tests focused on the contract.
 */

import { describe, expect, test } from 'vitest';
import {
  BRING_IN_APP_ADAPTERS,
  findAdapter,
  _buildClaudeDesktopPromptForTests as buildPrompt,
  _buildExternalLLMPromptForTests as buildExternalPrompt
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

describe('buildExternalLLMPrompt', () => {
  test('includes the room name and default trailing', () => {
    const prompt = buildExternalPrompt(samplePayload);
    expect(prompt).toContain('"Speed Matters"');
    expect(prompt).toContain('Please help me think about this.');
  });

  test('includes custom trailing when provided', () => {
    const prompt = buildExternalPrompt(samplePayload, { trailing: 'Custom sign-off.' });
    expect(prompt).toContain('Custom sign-off.');
    expect(prompt).not.toContain('Please help me think about this.');
  });

  test('includes description when present', () => {
    const prompt = buildExternalPrompt(samplePayload);
    expect(prompt).toContain('Overnight delivery sprint');
  });

  test('omits description section when null', () => {
    const prompt = buildExternalPrompt({ ...samplePayload, roomDescription: null });
    expect(prompt).not.toContain('Room context:');
  });

  test('omits open-asks section when null', () => {
    const prompt = buildExternalPrompt({ ...samplePayload, openAsksMarkdown: null });
    expect(prompt).not.toContain('Open asks');
  });

  test('omits recent-messages section when empty', () => {
    const prompt = buildExternalPrompt({ ...samplePayload, recentMessagesMarkdown: '' });
    expect(prompt).not.toContain('Recent conversation:');
  });

  test('sections are blank-line separated for readability', () => {
    const prompt = buildExternalPrompt(samplePayload);
    expect(prompt.includes('\n\n')).toBe(true);
  });
});

describe('buildClaudeDesktopPrompt', () => {
  test('is a thin wrapper around buildExternalLLMPrompt with default trailing', () => {
    const prompt = buildPrompt(samplePayload);
    expect(prompt).toContain('"Speed Matters"');
    expect(prompt).toContain('Please help me think about this.');
  });
});

describe('BRING_IN_APP_ADAPTERS', () => {
  test('exposes exactly the five v0.5 targets', () => {
    const targets = BRING_IN_APP_ADAPTERS.map((a) => a.target).sort();
    expect(targets).toEqual([
      'chatgpt',
      'claude-desktop',
      'claude-mobile',
      'codex-desktop',
      'gemini'
    ]);
  });

  test('Claude Desktop and ChatGPT are the v0.5-available adapters', () => {
    const available = BRING_IN_APP_ADAPTERS.filter((a) => a.available);
    expect(available.map((a) => a.target).sort()).toEqual(['chatgpt', 'claude-desktop']);
  });

  test('every unavailable adapter carries a user-visible reason', () => {
    for (const adapter of BRING_IN_APP_ADAPTERS) {
      if (!adapter.available) {
        expect(adapter.unavailableReason).toBeTruthy();
      }
    }
  });

  test('findAdapter looks up by target', () => {
    expect(findAdapter('claude-desktop')?.label).toBe('Bring in Claude Desktop');
    expect(findAdapter('chatgpt')?.available).toBe(true);
    expect(findAdapter('codex-desktop')?.available).toBe(false);
  });
});
