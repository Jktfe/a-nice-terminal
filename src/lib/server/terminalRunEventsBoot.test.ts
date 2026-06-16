import { beforeEach, describe, expect, it, vi } from 'vitest';

const bootMocks = vi.hoisted(() => ({
  outputCb: undefined as undefined | ((sessionId: string, data: string) => void),
  resetCb: undefined as undefined | ((sessionId: string) => void),
  appendTerminalRunEvent: vi.fn(),
  broadcastTerminalEvent: vi.fn(),
  dispatchClassify: vi.fn(),
  dispatchInteractiveDetect: vi.fn(),
  resolveAgentKind: vi.fn(),
  normalizeForClassifier: vi.fn()
}));

vi.mock('./ptyClient', () => ({
  subscribeOutput: vi.fn((cb: (sessionId: string, data: string) => void) => {
    bootMocks.outputCb = cb;
    return () => {};
  }),
  subscribeReset: vi.fn((cb: (sessionId: string) => void) => {
    bootMocks.resetCb = cb;
    return () => {};
  })
}));

vi.mock('./terminalRunEventsStore', () => ({
  appendTerminalRunEvent: bootMocks.appendTerminalRunEvent
}));

vi.mock('./classifierRegistry', () => ({
  dispatchClassify: bootMocks.dispatchClassify
}));

vi.mock('./terminalEventBroadcast', () => ({
  broadcastTerminalEvent: bootMocks.broadcastTerminalEvent
}));

vi.mock('./interactiveEvents/registry', () => ({
  dispatchInteractiveDetect: bootMocks.dispatchInteractiveDetect
}));

vi.mock('./interactiveEvents/agentKindResolver', () => ({
  resolveAgentKind: bootMocks.resolveAgentKind
}));

vi.mock('./classifiers/stripAnsi', () => ({
  normalizeForClassifier: bootMocks.normalizeForClassifier
}));

vi.mock('./claudeCodeTranscriptTailWatcher', () => ({ ensureTranscriptTailWatcherBooted: vi.fn() }));
vi.mock('./codexTranscriptTailWatcher', () => ({ ensureCodexTranscriptTailWatcherBooted: vi.fn() }));
vi.mock('./piTranscriptTailWatcher', () => ({ ensurePiTranscriptTailWatcherBooted: vi.fn() }));
vi.mock('./geminiTranscriptTailWatcher', () => ({ ensureGeminiTranscriptTailWatcherBooted: vi.fn() }));
vi.mock('./qwenTranscriptTailWatcher', () => ({ ensureQwenTranscriptTailWatcherBooted: vi.fn() }));
vi.mock('./copilotTranscriptTailWatcher', () => ({ ensureCopilotTranscriptTailWatcherBooted: vi.fn() }));
vi.mock('./linkedRoomAgentGuffPurge', () => ({ ensureLinkedRoomGuffPurgedOnce: vi.fn() }));

describe('terminalRunEventsBoot', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(1_780_000_000_000);
    delete (globalThis as { __antRunEventsBooted?: boolean }).__antRunEventsBooted;
    bootMocks.outputCb = undefined;
    bootMocks.resetCb = undefined;
    bootMocks.appendTerminalRunEvent.mockReset();
    bootMocks.broadcastTerminalEvent.mockReset();
    bootMocks.dispatchClassify.mockReset();
    bootMocks.dispatchInteractiveDetect.mockReset();
    bootMocks.resolveAgentKind.mockReset();
    bootMocks.normalizeForClassifier.mockReset();
    bootMocks.resolveAgentKind.mockReturnValue(null);
    bootMocks.normalizeForClassifier.mockImplementation((chunk: string) => `clean:${chunk}`);
    bootMocks.dispatchClassify.mockReturnValue([
      { kind: 'message', text: 'classified line', trust: 'medium' }
    ]);
    bootMocks.dispatchInteractiveDetect.mockReturnValue({ events: [], consumedBytes: 0 });
  });

  it('persists exact PTY chunks before normalized classifier rows', async () => {
    const { ensureRunEventsPersistenceBooted } = await import('./terminalRunEventsBoot');
    ensureRunEventsPersistenceBooted();

    const chunk = '\u001b[31mred\u001b[0m\r\npartial';
    bootMocks.outputCb?.('t-stream-1', chunk);

    expect(bootMocks.appendTerminalRunEvent).toHaveBeenNthCalledWith(1, {
      terminalId: 't-stream-1',
      kind: 'raw',
      text: chunk,
      trust: 'raw',
      source: 'pty_raw',
      tsMs: 1_780_000_000_000,
      payload: { stream: 'pty', exact: true }
    });
    expect(bootMocks.normalizeForClassifier).toHaveBeenCalledWith(chunk);
    expect(bootMocks.dispatchClassify).toHaveBeenCalledWith({
      sessionId: 't-stream-1',
      chunk: `clean:${chunk}`,
      agentKindHint: null
    });
    expect(bootMocks.appendTerminalRunEvent).toHaveBeenNthCalledWith(2, {
      terminalId: 't-stream-1',
      kind: 'message',
      text: 'classified line',
      trust: 'medium',
      tsMs: 1_780_000_000_000
    });
    expect(bootMocks.broadcastTerminalEvent).toHaveBeenCalledTimes(1);
    expect(bootMocks.broadcastTerminalEvent).toHaveBeenCalledWith('t-stream-1', {
      kind: 'message',
      text: 'classified line',
      trust: 'medium',
      ts_ms: 1_780_000_000_000,
      source: 'pty'
    });
  });

  it('does not let raw retention failures starve classified render events', async () => {
    bootMocks.appendTerminalRunEvent.mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY');
    });
    const { ensureRunEventsPersistenceBooted } = await import('./terminalRunEventsBoot');
    ensureRunEventsPersistenceBooted();

    bootMocks.outputCb?.('t-stream-2', 'hello\n');

    expect(bootMocks.normalizeForClassifier).toHaveBeenCalledWith('hello\n');
    expect(bootMocks.dispatchClassify).toHaveBeenCalledWith({
      sessionId: 't-stream-2',
      chunk: 'clean:hello\n',
      agentKindHint: null
    });
    expect(bootMocks.appendTerminalRunEvent).toHaveBeenCalledTimes(2);
    expect(bootMocks.appendTerminalRunEvent).toHaveBeenNthCalledWith(2, {
      terminalId: 't-stream-2',
      kind: 'message',
      text: 'classified line',
      trust: 'medium',
      tsMs: 1_780_000_000_000
    });
    expect(bootMocks.broadcastTerminalEvent).toHaveBeenCalledWith('t-stream-2', {
      kind: 'message',
      text: 'classified line',
      trust: 'medium',
      ts_ms: 1_780_000_000_000,
      source: 'pty'
    });
  });
});
