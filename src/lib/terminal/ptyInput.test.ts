import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postInput, sendText, handleSpecialKey } from './ptyInput';

const realFetch = globalThis.fetch;
let bodies: string[];

function captureFetch() {
  bodies = [];
  globalThis.fetch = vi.fn(async (_u: unknown, o: { body?: string } = {}) => {
    if (typeof o.body === 'string') bodies.push(o.body);
    return { ok: true, status: 202 } as unknown as Response;
  }) as unknown as typeof fetch;
}

function dataOf(body: string): string {
  return (JSON.parse(body) as { data: string }).data;
}

// The CR is sent on a real 5ms setTimeout — fake timers are unreliable
// under bun (banked vitest-date-mocking-limits), so wait real-time.
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(captureFetch);
afterEach(() => { globalThis.fetch = realFetch; });

describe('ptyInput', () => {
  it('postInput POSTs the data once', async () => {
    await postInput('t1', 'ls');
    expect(bodies.map(dataOf)).toEqual(['ls']);
  });

  it('postInput drops a terminal-response loopback frame', async () => {
    // A pure cursor-position-report response should be filtered (guard).
    await postInput('t1', '\x1b[12;34R');
    expect(bodies).toHaveLength(0);
  });

  it('sendText issues the text then a CR (two-call protocol)', async () => {
    await sendText('t1', 'echo hi');
    await settle();
    expect(bodies.map(dataOf)).toEqual(['echo hi', '\r']);
  });

  it('sendText does not double-CR when text already ends with newline', async () => {
    await sendText('t1', 'echo hi\n');
    await settle();
    expect(bodies.map(dataOf)).toEqual(['echo hi\n']);
  });

  it('handleSpecialKey paste-branch: multi-char text → text then CR', async () => {
    await handleSpecialKey('t1', 'pasted multi word');
    await settle();
    expect(bodies.map(dataOf)).toEqual(['pasted multi word', '\r']);
  });

  it('handleSpecialKey raw-seq branch: control sequence sent as-is, no CR', async () => {
    await handleSpecialKey('t1', '\x03'); // Ctrl-C
    await settle();
    expect(bodies.map(dataOf)).toEqual(['\x03']);
  });

  it('handleSpecialKey raw-seq branch: ESC sequence sent as-is, no CR', async () => {
    await handleSpecialKey('t1', '\x1b[Z'); // shift-tab
    await settle();
    expect(bodies.map(dataOf)).toEqual(['\x1b[Z']);
  });
});
