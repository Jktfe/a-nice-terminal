import { describe, expect, it } from 'vitest';
import { resolveTerminalRendererFlag, waitForTerminalFonts } from '../src/lib/components/Terminal/renderer.js';

describe('terminal renderer flag', () => {
  it('defaults to the DOM renderer', () => {
    expect(resolveTerminalRendererFlag({}).mode).toBe('dom');
    expect(resolveTerminalRendererFlag({}).source).toBe('default');
  });

  it('accepts webgl from the URL flag', () => {
    const decision = resolveTerminalRendererFlag({
      search: '?renderer=webgl',
      storageValue: 'dom',
      envValues: ['dom'],
    });

    expect(decision).toMatchObject({ mode: 'webgl', source: 'url' });
  });

  it('accepts uppercase RENDERER from the URL flag', () => {
    const decision = resolveTerminalRendererFlag({ search: '?RENDERER=webgl' });

    expect(decision).toMatchObject({ mode: 'webgl', source: 'url' });
  });

  it('falls through invalid values without enabling WebGL', () => {
    const decision = resolveTerminalRendererFlag({
      search: '?renderer=canvas',
      storageValue: 'gpu',
      envValues: ['webgl'],
    });

    expect(decision).toMatchObject({ mode: 'webgl', source: 'env' });
  });

  it('uses localStorage before build-time env aliases', () => {
    const decision = resolveTerminalRendererFlag({
      storageValue: 'dom',
      envValues: ['webgl'],
    });

    expect(decision).toMatchObject({ mode: 'dom', source: 'localStorage' });
  });

  it('waits for document fonts before WebGL activation', async () => {
    const doc = { fonts: { ready: Promise.resolve() } } as unknown as Document;

    await expect(waitForTerminalFonts(doc)).resolves.toBe(true);
  });

  it('treats unavailable font readiness as unsafe for WebGL', async () => {
    const doc = {} as Document;

    await expect(waitForTerminalFonts(doc)).resolves.toBe(false);
  });
});
