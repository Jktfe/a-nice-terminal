import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listTerminalRecords, getTranscriptTailParser } = vi.hoisted(() => ({
  listTerminalRecords: vi.fn(),
  getTranscriptTailParser: vi.fn()
}));

vi.mock('./terminalRecordsStore', () => ({ listTerminalRecords }));
vi.mock('./transcriptTailParser', () => ({ getTranscriptTailParser }));
vi.mock('./terminalRunEventsStore', () => ({ appendTerminalRunEvent: vi.fn() }));
vi.mock('./terminalEventBroadcast', () => ({ broadcastTerminalEvent: vi.fn() }));
vi.mock('./transcriptToChatFanout', () => ({ fanoutMessageToLinkedChatRoom: vi.fn() }));
vi.mock('./terminalsStore', () => ({ setAgentContextFill: vi.fn() }));
vi.mock('./transcriptEventId', () => ({ transcriptEventKey: vi.fn(() => 'event-key') }));

describe('genericTranscriptTailWatcher batching', () => {
  beforeEach(async () => {
    vi.resetModules();
    listTerminalRecords.mockReset();
    getTranscriptTailParser.mockReset();
    delete process.env.ANT_TRANSCRIPT_TAIL_POLL_MS;
    delete process.env.ANT_TRANSCRIPT_TAIL_MAX_RECORDS_PER_TICK;
  });

  it('tails a bounded round-robin batch instead of every terminal record on each tick', async () => {
    const visited: string[] = [];
    const parser = {
      name: 'test',
      findJsonlPath: vi.fn((record: { session_id: string }) => {
        visited.push(record.session_id);
        return null;
      }),
      parseLine: vi.fn(() => []),
      nativeIdFromLine: vi.fn(() => null),
      readContextFill: vi.fn(() => null)
    };
    listTerminalRecords.mockReturnValue([
      { session_id: 'a', agent_kind: 'codex', tmux_target_pane: 'a:0.0', created_at_ms: 1 },
      { session_id: 'b', agent_kind: 'codex', tmux_target_pane: 'b:0.0', created_at_ms: 1 },
      { session_id: 'c', agent_kind: 'codex', tmux_target_pane: 'c:0.0', created_at_ms: 1 },
      { session_id: 'd', agent_kind: 'codex', tmux_target_pane: 'd:0.0', created_at_ms: 1 }
    ]);
    getTranscriptTailParser.mockReturnValue(parser);

    const { tailNextBatchOnce } = await import('./genericTranscriptTailWatcher');

    expect(tailNextBatchOnce({ maxRecords: 2 })).toBe(0);
    expect(visited).toEqual(['a', 'b']);

    expect(tailNextBatchOnce({ maxRecords: 2 })).toBe(0);
    expect(visited).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps explicit tailAllOnce exhaustive for manual catch-up callers', async () => {
    const visited: string[] = [];
    const parser = {
      name: 'test',
      findJsonlPath: vi.fn((record: { session_id: string }) => {
        visited.push(record.session_id);
        return null;
      }),
      parseLine: vi.fn(() => []),
      nativeIdFromLine: vi.fn(() => null),
      readContextFill: vi.fn(() => null)
    };
    listTerminalRecords.mockReturnValue([
      { session_id: 'a', agent_kind: 'codex', tmux_target_pane: 'a:0.0', created_at_ms: 1 },
      { session_id: 'b', agent_kind: 'codex', tmux_target_pane: 'b:0.0', created_at_ms: 1 },
      { session_id: 'c', agent_kind: 'codex', tmux_target_pane: 'c:0.0', created_at_ms: 1 }
    ]);
    getTranscriptTailParser.mockReturnValue(parser);

    const { tailAllOnce } = await import('./genericTranscriptTailWatcher');

    expect(tailAllOnce()).toBe(0);
    expect(visited).toEqual(['a', 'b', 'c']);
  });

  it('reads bounded poll configuration from environment', async () => {
    process.env.ANT_TRANSCRIPT_TAIL_POLL_MS = '60000';
    process.env.ANT_TRANSCRIPT_TAIL_MAX_RECORDS_PER_TICK = '1';

    const {
      transcriptTailPollIntervalMs,
      transcriptTailMaxRecordsPerTick
    } = await import('./genericTranscriptTailWatcher');

    expect(transcriptTailPollIntervalMs()).toBe(60_000);
    expect(transcriptTailMaxRecordsPerTick()).toBe(1);
  });
});
