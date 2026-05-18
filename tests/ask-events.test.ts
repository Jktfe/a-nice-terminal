import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/server/db.js', () => ({
  queries: { appendRunEvent: vi.fn() },
}));

import { queries } from '../src/lib/server/db.js';
import { emitAskRunEvent } from '../src/lib/server/ask-events.js';

const appendRunEvent = vi.mocked(queries.appendRunEvent);

function makeAsk(overrides?: Partial<any>) {
  return {
    id: 'ask-1',
    session_id: 'room-1',
    title: 'Test ask',
    status: 'open',
    assigned_to: null,
    owner_kind: null,
    priority: null,
    inferred: false,
    confidence: 0,
    answer: null,
    answer_action: null,
    ...overrides,
  };
}

describe('ask-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits ask_created with core fields', () => {
    emitAskRunEvent('ask_created', makeAsk());
    expect(appendRunEvent).toHaveBeenCalledTimes(1);
    const [, , source, trust, kind, text, payloadJson, rawRef] = appendRunEvent.mock.calls[0];
    expect(source).toBe('json');
    expect(trust).toBe('high');
    expect(kind).toBe('ask_created');
    expect(text).toBe('Test ask');
    expect(rawRef).toBe('ask:ask-1');
    const payload = JSON.parse(payloadJson);
    expect(payload).toMatchObject({
      ask_id: 'ask-1',
      title: 'Test ask',
      status: 'open',
      assigned_to: null,
      inferred: false,
      confidence: 0,
    });
  });

  it('emits ask_updated with answer field', () => {
    emitAskRunEvent('ask_updated', makeAsk({ answer: 'Yes, proceed' }));
    const [, , , , , , payloadJson] = appendRunEvent.mock.calls[0];
    const payload = JSON.parse(payloadJson);
    expect(payload.answer).toBe('Yes, proceed');
  });

  it('does not include answer on ask_created', () => {
    emitAskRunEvent('ask_created', makeAsk({ answer: 'ignored' }));
    const [, , , , , , payloadJson] = appendRunEvent.mock.calls[0];
    const payload = JSON.parse(payloadJson);
    expect(payload).not.toHaveProperty('answer');
  });

  it('includes previous_status when it differs', () => {
    emitAskRunEvent('ask_updated', makeAsk({ status: 'answered' }), { previousStatus: 'open' });
    const [, , , , , , payloadJson] = appendRunEvent.mock.calls[0];
    expect(JSON.parse(payloadJson).previous_status).toBe('open');
  });

  it('skips previous_status when it matches current', () => {
    emitAskRunEvent('ask_updated', makeAsk({ status: 'open' }), { previousStatus: 'open' });
    const [, , , , , , payloadJson] = appendRunEvent.mock.calls[0];
    expect(JSON.parse(payloadJson)).not.toHaveProperty('previous_status');
  });

  it('includes action and bridge when provided', () => {
    emitAskRunEvent('ask_updated', makeAsk(), {
      action: 'approve',
      bridge: { ok: true, injected: 'yes' },
    });
    const [, , , , , , payloadJson] = appendRunEvent.mock.calls[0];
    const payload = JSON.parse(payloadJson);
    expect(payload.action).toBe('approve');
    expect(payload.bridge).toEqual({ ok: true, injected: 'yes' });
  });

  it('includes answer_action when present', () => {
    emitAskRunEvent('ask_created', makeAsk({ answer_action: 'close' }));
    const [, , , , , , payloadJson] = appendRunEvent.mock.calls[0];
    expect(JSON.parse(payloadJson).answer_action).toBe('close');
  });

  it('coerces inferred 1 to true', () => {
    emitAskRunEvent('ask_created', makeAsk({ inferred: 1 }));
    const [, , , , , , payloadJson] = appendRunEvent.mock.calls[0];
    expect(JSON.parse(payloadJson).inferred).toBe(true);
  });

  it('catches appendRunEvent errors without throwing', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    appendRunEvent.mockImplementation(() => { throw new Error('db locked'); });
    expect(() => emitAskRunEvent('ask_created', makeAsk())).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
