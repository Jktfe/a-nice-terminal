import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { setRoomMode } from './roomModesStore';
import { createClaim, resetEntityClaimStoreForTests } from './entityClaimStore';
import {
  emitClaimRelay,
  HOLD_MESSAGE,
  AVAILABLE_MESSAGE,
  takenMessage,
  type ClaimTransition
} from './headsDownRelay';

const ROOM = 'r-headsdown';
const MSG = 'msg_headsdown_1';

function collectSink() {
  const sent: Array<{ handle: string; body: string }> = [];
  return { sent, sink: (handle: string, body: string) => sent.push({ handle, body }) };
}

function look(handle: string) {
  createClaim({ entity_kind: 'message', entity_id: MSG, claim_kind: 'looking', claimed_by_handle: handle });
}
function work(handle: string) {
  createClaim({
    entity_kind: 'message',
    entity_id: MSG,
    claim_kind: 'working',
    claimed_by_handle: handle,
    default_working_ttl_ms: 30 * 60_000
  });
}
function pass(handle: string) {
  createClaim({ entity_kind: 'message', entity_id: MSG, claim_kind: 'pass', claimed_by_handle: handle });
}
function transition(claimKind: ClaimTransition['claimKind'], handle: string): ClaimTransition {
  return { roomId: ROOM, entityKind: 'message', entityId: MSG, claimKind, claimedByHandle: handle };
}

describe('headsDownRelay — responder relay notifications', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetEntityClaimStoreForTests();
    setRoomMode({ roomId: ROOM, mode: 'heads-down', set_by: '@JWPK' });
  });
  afterEach(() => resetEntityClaimStoreForTests());

  it('no-ops outside heads-down mode', () => {
    setRoomMode({ roomId: ROOM, mode: 'brainstorm', set_by: '@JWPK' });
    look('@a');
    look('@b');
    const { sent, sink } = collectSink();
    emitClaimRelay(transition('looking', '@b'), sink);
    expect(sent).toHaveLength(0);
  });

  it('no-ops for non-message entities', () => {
    const { sent, sink } = collectSink();
    emitClaimRelay({ roomId: ROOM, entityKind: 'task', entityId: 't1', claimKind: 'working', claimedByHandle: '@a' }, sink);
    expect(sent).toHaveLength(0);
  });

  it('first looker gets nothing; a second looker is told to hold', () => {
    look('@a');
    const first = collectSink();
    emitClaimRelay(transition('looking', '@a'), first.sink);
    expect(first.sent).toHaveLength(0); // nobody else busy yet

    look('@b');
    const second = collectSink();
    emitClaimRelay(transition('looking', '@b'), second.sink);
    expect(second.sent).toEqual([{ handle: '@b', body: HOLD_MESSAGE }]);
  });

  it('taken notifies the other readers it is taken + where to send notes', () => {
    look('@a');
    look('@b');
    work('@a');
    const { sent, sink } = collectSink();
    emitClaimRelay(transition('working', '@a'), sink);
    expect(sent).toEqual([{ handle: '@b', body: takenMessage('@a') }]);
  });

  it('pass tells the other readers it is available to claim', () => {
    look('@a');
    look('@b');
    pass('@a');
    const { sent, sink } = collectSink();
    emitClaimRelay(transition('pass', '@a'), sink);
    expect(sent).toEqual([{ handle: '@b', body: AVAILABLE_MESSAGE }]);
  });

  it('does not notify the actor themselves', () => {
    look('@a');
    work('@a');
    const { sent, sink } = collectSink();
    emitClaimRelay(transition('working', '@a'), sink);
    // only @a is involved → no other readers → no relay
    expect(sent).toHaveLength(0);
  });
});
