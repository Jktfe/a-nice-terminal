import { describe, expect, it, vi } from 'vitest';
import { makeRuntime, SECTIONS } from './seed-overnight-plan.mjs';

describe('seed-overnight-plan', () => {
  it('SECTIONS has 5 entries in order', () => {
    expect(SECTIONS).toHaveLength(5);
    expect(SECTIONS[0]).toEqual({ title: 'Foundation', order: 1 });
    expect(SECTIONS[1]).toEqual({ title: 'Identity',   order: 2 });
    expect(SECTIONS[2]).toEqual({ title: 'Injection',  order: 3 });
    expect(SECTIONS[3]).toEqual({ title: 'Dogfood',    order: 4 });
    expect(SECTIONS[4]).toEqual({ title: 'Followups',  order: 5 });
  });

  it('makeRuntime uses defaults', () => {
    const rt = makeRuntime();
    expect(typeof rt.fetchImpl).toBe('function');
    expect(rt.serverUrl).toBe(process.env.ANT_SERVER_URL || 'http://127.0.0.1:6174');
    expect(typeof rt.writeOut).toBe('function');
    expect(typeof rt.writeErr).toBe('function');
  });

  it('makeRuntime allows overrides', () => {
    const customFetch = vi.fn();
    const customWrite = vi.fn();
    const rt = makeRuntime({
      fetchImpl: customFetch,
      serverUrl: 'http://custom:9999',
      writeOut: customWrite
    });
    expect(rt.fetchImpl).toBe(customFetch);
    expect(rt.serverUrl).toBe('http://custom:9999');
    expect(rt.writeOut).toBe(customWrite);
  });

  it('makeRuntime partial override keeps defaults', () => {
    const rt = makeRuntime({ serverUrl: 'http://partial:8080' });
    expect(rt.serverUrl).toBe('http://partial:8080');
    expect(typeof rt.fetchImpl).toBe('function');
    expect(typeof rt.writeOut).toBe('function');
  });
});
