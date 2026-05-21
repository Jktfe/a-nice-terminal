import { beforeEach, describe, expect, it } from 'vitest';
import {
  listAgentEventsInRoom,
  recordAgentEvent,
  resetAgentTimelineStoreForTests
} from './agentTimelineStore';

describe('agentTimelineStore', () => {
  beforeEach(() => {
    resetAgentTimelineStoreForTests();
  });

  it('recordAgentEvent returns an event with the given fields', () => {
    const newEvent = recordAgentEvent({
      roomId: 'r1',
      authorHandle: '@evolveantclaude',
      kind: 'tool-call',
      summary: 'batch_design wrote 22 nodes'
    });
    expect(newEvent.id.startsWith('ev_')).toBe(true);
    expect(newEvent.kind).toBe('tool-call');
    expect(newEvent.summary).toBe('batch_design wrote 22 nodes');
    expect(newEvent.authorHandle).toBe('@evolveantclaude');
    expect(newEvent.authorDisplayName).toBe('@evolveantclaude');
  });

  it('authorDisplayName defaults to the handle but can be overridden', () => {
    const newEvent = recordAgentEvent({
      roomId: 'r1',
      authorHandle: '@kimi',
      authorDisplayName: 'Kimi (audit lane)',
      kind: 'status-transition',
      summary: 'idle → thinking'
    });
    expect(newEvent.authorDisplayName).toBe('Kimi (audit lane)');
  });

  it('rejects a blank summary', () => {
    expect(() =>
      recordAgentEvent({
        roomId: 'r1',
        authorHandle: '@kimi',
        kind: 'tool-call',
        summary: '   '
      })
    ).toThrow();
  });

  it('rejects a blank authorHandle', () => {
    expect(() =>
      recordAgentEvent({
        roomId: 'r1',
        authorHandle: '   ',
        kind: 'tool-call',
        summary: 'x'
      })
    ).toThrow();
  });

  it('listAgentEventsInRoom returns events in record order', () => {
    const first = recordAgentEvent({
      roomId: 'r1',
      authorHandle: '@a',
      kind: 'tool-call',
      summary: 'first'
    });
    const second = recordAgentEvent({
      roomId: 'r1',
      authorHandle: '@a',
      kind: 'tool-call',
      summary: 'second'
    });
    const third = recordAgentEvent({
      roomId: 'r1',
      authorHandle: '@b',
      kind: 'plan-mode-entered',
      summary: 'plan opened'
    });
    expect(listAgentEventsInRoom('r1').map((e) => e.id)).toEqual([
      first.id,
      second.id,
      third.id
    ]);
  });

  it('listAgentEventsInRoom returns an empty array for a room with no events', () => {
    expect(listAgentEventsInRoom('unknown-room')).toEqual([]);
  });

  it('rooms are isolated — events in r1 do not appear in r2', () => {
    recordAgentEvent({
      roomId: 'r1',
      authorHandle: '@a',
      kind: 'tool-call',
      summary: 'r1 event'
    });
    expect(listAgentEventsInRoom('r2')).toEqual([]);
  });

  it('preserves the details payload exactly as provided', () => {
    const details = { toolName: 'batch_design', operationCount: 22 };
    const newEvent = recordAgentEvent({
      roomId: 'r1',
      authorHandle: '@a',
      kind: 'tool-call',
      summary: 'with details',
      details
    });
    expect(newEvent.details).toEqual(details);
  });
});
