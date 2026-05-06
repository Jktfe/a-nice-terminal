// M1 #1 — screenshot capture helper tests (DI, no real screencapture)
import { describe, expect, it } from 'vitest';
import { captureScreenshot } from '../src/lib/server/capture/screenshot.js';

describe('captureScreenshot', () => {
  it('writes file, hashes, and emits run_event', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const written: Record<string, Buffer> = {};

    const deps = {
      execFile: async (_cmd: string, args: string[]) => {
        const path = args[args.length - 1];
        written[path] = Buffer.from('fake-png-data');
        return { stdout: '', stderr: '' };
      },
      readFile: async (path: string) => written[path] ?? Buffer.from(''),
      createHash: (_algo: string) => {
        let data = Buffer.alloc(0);
        return {
          update: function(buf: Buffer) { data = Buffer.concat([data, buf]); return this; },
          digest: function(_enc: 'hex') { return 'aabbccdd'; },
        };
      },
      nowMs: () => 1730000000000,
      mkdir: (_dir: string) => {},
      insertRunEvent: async (args: any) => { captured.push(args); },
    };

    const result = await captureScreenshot('sess-123', '/tmp/evidence/screenshots', deps as any);

    expect(result.path).toMatch(/sess-123-1730000000000\.png$/);
    expect(result.sha256).toBe('aabbccdd');
    expect(result.bytes).toBe(13); // 'fake-png-data'.length
    expect(result.tsMs).toBe(1730000000000);

    expect(captured).toHaveLength(1);
    const ev = captured[0];
    expect(ev.sessionId).toBe('sess-123');
    expect(ev.tsMs).toBe(1730000000000);
    expect(ev.source).toBe('hook');
    expect(ev.trust).toBe('high');
    expect(ev.kind).toBe('screenshot');
    expect(ev.text).toContain('Screenshot captured');
    const payload = JSON.parse(ev.payload as string);
    expect(payload.sha256).toBe('aabbccdd');
    expect(payload.bytes).toBe(13);
    expect(payload.path).toMatch(/sess-123-1730000000000\.png$/);
  });

  it('creates different filenames per timestamp', async () => {
    let ts = 1730000000000;
    const deps = {
      execFile: async () => ({ stdout: '', stderr: '' }),
      readFile: async () => Buffer.from('x'),
      createHash: () => { let data = Buffer.alloc(0); return { update: function() { return this; }, digest: function() { return '00'; } }; },
      nowMs: () => { const v = ts; ts++; return v; },
      mkdir: () => {},
      insertRunEvent: async () => {},
    };

    const r1 = await captureScreenshot('s1', '/tmp', deps as any);
    const r2 = await captureScreenshot('s1', '/tmp', deps as any);
    expect(r1.path).not.toBe(r2.path);
  });

  it('propagates execFile errors', async () => {
    const deps = {
      execFile: async () => { throw new Error('screencapture failed'); },
      readFile: async () => Buffer.from(''),
      createHash: () => { return { update: function() { return this; }, digest: function() { return ''; } }; },
      nowMs: () => 0,
      mkdir: () => {},
      insertRunEvent: async () => {},
    };
    await expect(captureScreenshot('s1', '/tmp', deps as any)).rejects.toThrow('screencapture failed');
  });

  it('calls mkdir on output directory', async () => {
    const dirs: string[] = [];
    const deps = {
      execFile: async () => ({ stdout: '', stderr: '' }),
      readFile: async () => Buffer.from('x'),
      createHash: () => { let data = Buffer.alloc(0); return { update: function() { return this; }, digest: function() { return '00'; } }; },
      nowMs: () => 0,
      mkdir: (dir: string) => { dirs.push(dir); },
      insertRunEvent: async () => {},
    };
    await captureScreenshot('s1', '/custom/evidence', deps as any);
    expect(dirs).toEqual(['/custom/evidence']);
  });
});
