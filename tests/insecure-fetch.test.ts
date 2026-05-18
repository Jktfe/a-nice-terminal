import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const mockRequest = vi.fn();
const mockReq = {
  on: vi.fn(),
  write: vi.fn(),
  end: vi.fn(),
};

vi.mock('node:http', () => ({
  request: (...args: any[]) => mockRequest(...args),
}));

vi.mock('node:https', () => ({
  request: (...args: any[]) => mockRequest(...args),
}));

import { insecureFetch } from '../src/lib/server/insecure-fetch.js';

function createMockRes(overrides?: Partial<any>, chunks?: string[]) {
  const res = new Readable({ read() {} });
  (res as any).statusCode = overrides?.statusCode ?? 200;
  (res as any).headers = overrides?.headers ?? { 'content-type': 'application/json' };
  setImmediate(() => {
    for (const chunk of (chunks || [])) res.push(Buffer.from(chunk));
    res.push(null);
  });
  return res;
}

describe('insecureFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequest.mockReturnValue(mockReq);
  });

  function triggerRequestCallback(res: any) {
    const cb = mockRequest.mock.calls[0][2] as (res: any) => void;
    cb(res);
  }

  it('resolves with status, ok, and headers for HTTP', async () => {
    const p = insecureFetch('http://example.com/test');
    triggerRequestCallback(createMockRes());
    const r = await p;
    expect(r.status).toBe(200);
    expect(r.ok).toBe(true);
    expect(r.headers.get('content-type')).toBe('application/json');
  });

  it('resolves with ok=false for 4xx', async () => {
    const p = insecureFetch('http://example.com/missing');
    triggerRequestCallback(createMockRes({ statusCode: 404 }));
    const r = await p;
    expect(r.status).toBe(404);
    expect(r.ok).toBe(false);
  });

  it('uses https with rejectUnauthorized:false', async () => {
    const p = insecureFetch('https://example.com/test');
    triggerRequestCallback(createMockRes());
    await p;
    const opts = mockRequest.mock.calls[0][1];
    expect(opts.rejectUnauthorized).toBe(false);
  });

  it('does not set rejectUnauthorized for http', async () => {
    const p = insecureFetch('http://example.com/test');
    triggerRequestCallback(createMockRes());
    await p;
    const opts = mockRequest.mock.calls[0][1];
    expect(opts.rejectUnauthorized).toBeUndefined();
  });

  it('passes method and headers', async () => {
    const p = insecureFetch('http://example.com/test', {
      method: 'POST',
      headers: { 'x-custom': 'val' },
    });
    triggerRequestCallback(createMockRes());
    await p;
    const opts = mockRequest.mock.calls[0][1];
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({ 'x-custom': 'val' });
  });

  it('writes body when provided', async () => {
    const p = insecureFetch('http://example.com/test', {
      method: 'POST',
      body: 'payload',
    });
    triggerRequestCallback(createMockRes());
    await p;
    expect(mockReq.write).toHaveBeenCalledWith('payload');
    expect(mockReq.end).toHaveBeenCalled();
  });

  it('text() returns concatenated chunks', async () => {
    const p = insecureFetch('http://example.com/test');
    triggerRequestCallback(createMockRes({}, ['hel', 'lo']));
    const r = await p;
    const text = await r.text();
    expect(text).toBe('hello');
  });

  it('joins array header values with comma-space', async () => {
    const p = insecureFetch('http://example.com/test');
    triggerRequestCallback(createMockRes({ headers: { 'set-cookie': ['a=1', 'b=2'] } }));
    const r = await p;
    expect(r.headers.get('set-cookie')).toBe('a=1, b=2');
  });

  it('rejects on request error', async () => {
    const p = insecureFetch('http://example.com/test');
    const errorCb = mockReq.on.mock.calls.find((c: any) => c[0] === 'error')![1];
    errorCb(new Error('ECONNREFUSED'));
    await expect(p).rejects.toThrow('ECONNREFUSED');
  });

  it('throws when body is accessed after text()', async () => {
    const p = insecureFetch('http://example.com/test');
    triggerRequestCallback(createMockRes({}, ['data']));
    const r = await p;
    await r.text();
    expect(() => r.body).toThrow(/already consumed/);
  });

  it('throws when text() is called after body', async () => {
    const p = insecureFetch('http://example.com/test');
    triggerRequestCallback(createMockRes({}, ['data']));
    const r = await p;
    void r.body;
    await expect(r.text()).rejects.toThrow(/already consumed/);
  });
});
