import { describe, it, expect, vi } from 'vitest';
import {
  buildConsentGrant,
  resolveConsentGrant,
  CONSENT_GRANT_VERSION,
  type ConsentGrant,
  type ConsentGrantQueries,
} from '../src/lib/server/consent/grant-scope.js';

function makeGrant(partial: Partial<ConsentGrant>): ConsentGrant {
  return {
    id: 'g1',
    session_id: 's1',
    granted_to: '@a',
    topic: 'file-read',
    source_set: [],
    duration: '1h',
    answer_count: 0,
    max_answers: null,
    status: 'active',
    granted_at_ms: 0,
    expires_at_ms: null,
    meta: '{}',
    ...partial,
  };
}

describe('grant-scope', () => {
  describe('buildConsentGrant', () => {
    it('builds a minimal active grant', () => {
      const g = buildConsentGrant({
        id: 'g1',
        sessionId: 's1',
        grantedTo: '@claude',
        topic: 'file-read',
        nowMs: 1_000_000,
      });
      expect(g.id).toBe('g1');
      expect(g.session_id).toBe('s1');
      expect(g.granted_to).toBe('@claude');
      expect(g.topic).toBe('file-read');
      expect(g.status).toBe('active');
      expect(g.answer_count).toBe(0);
      expect(g.max_answers).toBeNull();
      expect(g.granted_at_ms).toBe(1_000_000);
      expect(g.expires_at_ms).toBe(1_000_000 + 60 * 60 * 1000);
      expect(g.meta).toBe('{}');
    });

    it('defaults duration to 1h', () => {
      const g = buildConsentGrant({ id: 'g1', sessionId: 's1', grantedTo: '@a', topic: 't', nowMs: 0 });
      expect(g.duration).toBe('1h');
      expect(g.expires_at_ms).toBe(60 * 60 * 1000);
    });

    it('supports forever duration', () => {
      const g = buildConsentGrant({
        id: 'g1', sessionId: 's1', grantedTo: '@a', topic: 't', duration: 'forever', nowMs: 0,
      });
      expect(g.expires_at_ms).toBeNull();
    });

    it('supports ad-hoc durations', () => {
      const g = buildConsentGrant({
        id: 'g1', sessionId: 's1', grantedTo: '@a', topic: 't', duration: '30m', nowMs: 0,
      });
      expect(g.expires_at_ms).toBe(30 * 60 * 1000);
    });

    it('stores source_set and meta', () => {
      const g = buildConsentGrant({
        id: 'g1', sessionId: 's1', grantedTo: '@a', topic: 't',
        sourceSet: ['/a.ts', '/b.ts'],
        meta: { reason: 'testing' },
      });
      expect(g.source_set).toEqual(['/a.ts', '/b.ts']);
      expect(JSON.parse(g.meta)).toEqual({ reason: 'testing' });
    });

    it('respects maxAnswers', () => {
      const g = buildConsentGrant({
        id: 'g1', sessionId: 's1', grantedTo: '@a', topic: 't', maxAnswers: 3,
      });
      expect(g.max_answers).toBe(3);
    });

    it('throws when id is empty', () => {
      expect(() => buildConsentGrant({ id: '', sessionId: 's1', grantedTo: '@a', topic: 't' })).toThrow(/id is required/);
    });

    it('throws when sessionId is empty', () => {
      expect(() => buildConsentGrant({ id: 'g1', sessionId: '', grantedTo: '@a', topic: 't' })).toThrow(/sessionId is required/);
    });

    it('throws when grantedTo is empty', () => {
      expect(() => buildConsentGrant({ id: 'g1', sessionId: 's1', grantedTo: '', topic: 't' })).toThrow(/grantedTo is required/);
    });

    it('throws when topic is empty', () => {
      expect(() => buildConsentGrant({ id: 'g1', sessionId: 's1', grantedTo: '@a', topic: '' })).toThrow(/topic is required/);
    });

    it('throws on unknown duration', () => {
      expect(() => buildConsentGrant({ id: 'g1', sessionId: 's1', grantedTo: '@a', topic: 't', duration: '99x' })).toThrow(/Unknown duration/);
    });
  });

  describe('resolveConsentGrant', () => {
    function makeQueries(grant: ConsentGrant | null): ConsentGrantQueries {
      return {
        getConsentGrant: vi.fn(() => grant),
        updateConsentGrant: vi.fn(),
      };
    }

    it('returns not_found when grant is absent', () => {
      const result = resolveConsentGrant(makeQueries(null), 'missing');
      expect(result).toEqual({ valid: false, reason: 'not_found' });
    });

    it('returns revoked when grant is revoked', () => {
      const result = resolveConsentGrant(makeQueries(makeGrant({ status: 'revoked' })), 'g1');
      expect(result).toEqual({ valid: false, reason: 'revoked' });
    });

    it('returns expired when past expiry', () => {
      const result = resolveConsentGrant(makeQueries(makeGrant({ expires_at_ms: 100 })), 'g1', { nowMs: 200 });
      expect(result).toEqual({ valid: false, reason: 'expired' });
    });

    it('returns exhausted when max_answers reached', () => {
      const result = resolveConsentGrant(makeQueries(makeGrant({ answer_count: 3, max_answers: 3 })), 'g1');
      expect(result).toEqual({ valid: false, reason: 'exhausted' });
    });

    it('returns valid without bumping when bump is false', () => {
      const q = makeQueries(makeGrant({ answer_count: 1, max_answers: 5 }));
      const result = resolveConsentGrant(q, 'g1') as any;
      expect(result.valid).toBe(true);
      expect(result.grant.answer_count).toBe(1);
      expect(result.remainingAnswers).toBe(4);
      expect(q.updateConsentGrant).not.toHaveBeenCalled();
    });

    it('bumps answer_count when bump is true', () => {
      const q = makeQueries(makeGrant({ answer_count: 1, max_answers: 5 }));
      const result = resolveConsentGrant(q, 'g1', { bump: true }) as any;
      expect(result.valid).toBe(true);
      expect(result.grant.answer_count).toBe(2);
      expect(result.remainingAnswers).toBe(3);
      expect(q.updateConsentGrant).toHaveBeenCalledWith('g1', 'active', 2, null);
    });

    it('passes when expiry is null (no expiry)', () => {
      const result = resolveConsentGrant(makeQueries(makeGrant({ expires_at_ms: null })), 'g1') as any;
      expect(result.valid).toBe(true);
      expect(result.remainingAnswers).toBeNull();
    });

    it('passes when within expiry window', () => {
      const result = resolveConsentGrant(makeQueries(makeGrant({ expires_at_ms: 200 })), 'g1', { nowMs: 100 }) as any;
      expect(result.valid).toBe(true);
    });

    it('remainingAnswers is 0 after final bump', () => {
      const q = makeQueries(makeGrant({ answer_count: 2, max_answers: 3 }));
      const result = resolveConsentGrant(q, 'g1', { bump: true }) as any;
      expect(result.remainingAnswers).toBe(0);
    });
  });
});
