import { describe, expect, it } from 'vitest';
import { decideRead, decideJoin, decidePost, type IdentityFacts } from './roomAccessGate';
import type { RoomPolicy } from './roomPolicyStore';

const facts = (over: Partial<IdentityFacts> = {}): IdentityFacts => ({
  isMember: false,
  isEntitled: false,
  isInvited: false,
  ...over
});
const policy = (join: RoomPolicy['joinPolicy'], read: RoomPolicy['readPolicy']): RoomPolicy => ({
  joinPolicy: join,
  readPolicy: read
});

describe('roomAccessGate — two-axis policy, decided on identity not pid', () => {
  it('read/join axes are independent', () => {
    const p = policy('invite', 'open'); // read-open, join-invite
    expect(decideRead(p, facts())).toBe(true); // anyone reads
    expect(decideJoin(p, facts())).toBe(false); // but not anyone joins
    expect(decideJoin(p, facts({ isInvited: true }))).toBe(true);
  });

  it('state semantics: open/allowed/invite/closed', () => {
    expect(decideRead(policy('closed', 'open'), facts())).toBe(true);
    expect(decideRead(policy('closed', 'allowed'), facts())).toBe(false);
    expect(decideRead(policy('closed', 'allowed'), facts({ isEntitled: true }))).toBe(true);
    expect(decideRead(policy('closed', 'invite'), facts({ isInvited: true }))).toBe(true);
    expect(decideRead(policy('closed', 'closed'), facts())).toBe(false);
    expect(decideRead(policy('closed', 'closed'), facts({ isMember: true }))).toBe(true);
  });

  // The auto-join-on-post spec's 4 cases (msg_qf1r6vbljb):
  describe('decidePost — auto-join-on-post rule', () => {
    it('case 1: non-member posts to OPEN room -> auto-join', () => {
      expect(decidePost('open', false)).toBe('auto-join');
    });
    it('case 3: non-member posts to CLOSED/INVITE/ALLOWED -> reject', () => {
      expect(decidePost('closed', false)).toBe('reject');
      expect(decidePost('invite', false)).toBe('reject');
      expect(decidePost('allowed', false)).toBe('reject');
    });
    it('case 4: already-member posts -> allow (idempotent), any policy', () => {
      expect(decidePost('open', true)).toBe('allow');
      expect(decidePost('closed', true)).toBe('allow');
      expect(decidePost('invite', true)).toBe('allow');
    });
    // case 2 (collision -> integer suffix) is @fast's allocateHandle, tested in
    // roomHandleLeaseStore; decidePost only routes to 'auto-join'.
  });
});
