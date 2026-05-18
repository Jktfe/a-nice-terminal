import { describe, it, expect } from 'vitest';
import { agentColor, agentColorFromSession, surfaceTokens, AGENTS } from '../src/lib/nocturne.js';

describe('nocturne', () => {
  describe('agentColor', () => {
    it('returns fallback for null', () => {
      const result = agentColor(null);
      expect(result.color).toBe('#8990A8');
      expect(result.glow).toBe('#BFC6D6');
    });

    it('returns fallback for undefined', () => {
      const result = agentColor(undefined);
      expect(result.color).toBe('#8990A8');
    });

    it('matches claude by handle', () => {
      expect(agentColor('@claude')).toEqual(AGENTS.claude);
    });

    it('matches codex by cli_flag', () => {
      expect(agentColor('codex')).toEqual(AGENTS.codex);
    });

    it('matches gemini case-insensitively', () => {
      expect(agentColor('Gemini')).toEqual(AGENTS.gemini);
    });

    it('returns a stable colour for unknown keys', () => {
      const a = agentColor('unknown-agent-1');
      const b = agentColor('unknown-agent-1');
      expect(a).toEqual(b);
      expect(Object.values(AGENTS)).toContainEqual(a);
    });

    it('returns different colours for different unknown keys', () => {
      const a = agentColor('agent-a');
      const b = agentColor('agent-b');
      expect(a.color).not.toBe(b.color);
    });
  });

  describe('agentColorFromSession', () => {
    it('prefers cli_flag over handle', () => {
      const result = agentColorFromSession({ cli_flag: 'claude', handle: '@codex' });
      expect(result).toEqual(AGENTS.claude);
    });

    it('falls back to handle when cli_flag is absent', () => {
      const result = agentColorFromSession({ handle: '@gemini' });
      expect(result).toEqual(AGENTS.gemini);
    });

    it('falls back to name when cli_flag and handle are absent', () => {
      const result = agentColorFromSession({ name: 'copilot' });
      expect(result).toEqual(AGENTS.copilot);
    });

    it('falls back to id when nothing else is present', () => {
      const result = agentColorFromSession({ id: 'ollama' });
      expect(result).toEqual(AGENTS.ollama);
    });

    it('returns fallback for null session', () => {
      expect(agentColorFromSession(null).color).toBe('#8990A8');
    });
  });

  describe('surfaceTokens', () => {
    it('returns dark mode tokens', () => {
      const tokens = surfaceTokens('dark');
      expect(tokens.bg).toBe('#0C1021');
      expect(tokens.text).toBe('#E3E7F0');
      expect(tokens.hairline).toBe('rgba(255,255,255,0.06)');
    });

    it('returns light mode tokens', () => {
      const tokens = surfaceTokens('light');
      expect(tokens.bg).toBe('#F7F7F5');
      expect(tokens.text).toBe('#1B1A15');
      expect(tokens.hairline).toBe('rgba(0,0,0,0.06)');
    });

    it('has all required keys in both modes', () => {
      const required = ['bg', 'elev', 'panel', 'raised', 'hairline', 'hairlineStrong', 'text', 'textMuted', 'textFaint'];
      for (const key of required) {
        expect(surfaceTokens('dark')).toHaveProperty(key);
        expect(surfaceTokens('light')).toHaveProperty(key);
      }
    });
  });
});
