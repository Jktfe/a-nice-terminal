import { describe, expect, it } from 'vitest';
import { NOCTURNE, AGENTS, surfaceTokens, agentColor } from './nocturne';

describe('nocturne', () => {
  it('exports palette with expected keys', () => {
    expect(NOCTURNE.emerald[500]).toBe('#22C55E');
    expect(NOCTURNE.blue[500]).toBe('#3B82F6');
    expect(NOCTURNE.amber[500]).toBe('#D98804');
    expect(NOCTURNE.pulse.hot).toBe('#B8F03E');
    expect(NOCTURNE.neutral[500]).toBe('#5A584B');
    expect(NOCTURNE.ink[500]).toBe('#222940');
    expect(NOCTURNE.semantic.success).toBe('#22C55E');
    expect(NOCTURNE.semantic.danger).toBe('#F04438');
  });

  it('has 6 agents', () => {
    expect(Object.keys(AGENTS)).toHaveLength(6);
  });

  it('returns dark surface tokens', () => {
    const dark = surfaceTokens('dark');
    expect(dark.bg).toBe(NOCTURNE.ink[900]);
    expect(dark.text).toBe(NOCTURNE.ink[50]);
  });

  it('returns light surface tokens', () => {
    const light = surfaceTokens('light');
    expect(light.bg).toBe(NOCTURNE.neutral[50]);
    expect(light.text).toBe(NOCTURNE.neutral[800]);
  });

  it('looks up known agent color', () => {
    const c = agentColor('claude');
    expect(c.color).toBe('#E07856');
    expect(c.glow).toBe('#F59A7E');
  });

  it('normalises @handle prefix', () => {
    expect(agentColor('@codex')).toEqual(AGENTS.codex);
    expect(agentColor('@CODEX')).toEqual(AGENTS.codex);
  });

  it('returns fallback for null/undefined', () => {
    expect(agentColor(null).color).toBe(NOCTURNE.ink[200]);
    expect(agentColor(undefined).color).toBe(NOCTURNE.ink[200]);
    expect(agentColor('').color).toBe(NOCTURNE.ink[200]);
  });

  it('deterministically hashes unknown agents', () => {
    const c1 = agentColor('unknown-agent');
    const c2 = agentColor('unknown-agent');
    expect(c1).toEqual(c2);
    expect(c1.color).toBeTruthy();
  });
});
