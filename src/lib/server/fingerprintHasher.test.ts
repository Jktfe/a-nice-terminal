import { describe, expect, it } from 'vitest';
import {
  hashCaptureOutput,
  deriveStateFromFingerprint,
  decideAgentStatus,
  type FingerprintDecision
} from './fingerprintHasher';

describe('fingerprintHasher (M3.4a-v2 T2 pure cascade)', () => {
  describe('hashCaptureOutput', () => {
    it('is deterministic for the same input', () => {
      expect(hashCaptureOutput('hello')).toBe(hashCaptureOutput('hello'));
    });

    it('produces different hashes for different inputs', () => {
      expect(hashCaptureOutput('hello')).not.toBe(hashCaptureOutput('hello\n'));
    });
  });

  describe('deriveStateFromFingerprint', () => {
    // ASK_PATTERN regex removed in asks-as-pill JWPK 2026-05-22 — response-
    // required is asks-store-derived, not fingerprint-derived. The capture
    // that used to produce response-required now falls through to one of
    // {working, thinking, idle, null} based on the change-detection rules.
    it('"Awaiting your direction" capture no longer maps to response-required', () => {
      const r = deriveStateFromFingerprint({
        captureText: '⏺ Awaiting your direction...',
        prevHash: 'abc',
        prevAtMs: 100,
        nowMs: 200
      });
      expect(r.status).not.toBe('response-required');
      // Hash changed + tool-call signature present + fresh → working
      expect(r.status).toBe('working');
    });

    it('returns working when hash changed within 5s AND tool-call signature visible', () => {
      const r = deriveStateFromFingerprint({
        captureText: '⏺ running bash command\nfile.txt',
        prevHash: 'different-hash-than-current',
        prevAtMs: 1000,
        nowMs: 3000
      });
      expect(r.status).toBe('working');
    });

    it('returns thinking when hash changed within 5s and no tool signature', () => {
      const r = deriveStateFromFingerprint({
        captureText: 'normal prose output no special markers',
        prevHash: 'old-hash',
        prevAtMs: 1000,
        nowMs: 3000
      });
      expect(r.status).toBe('thinking');
    });

    it('returns idle when hash unchanged for more than 30s', () => {
      const sameText = 'idle prompt ready for next input';
      const hash = hashCaptureOutput(sameText);
      const r = deriveStateFromFingerprint({
        captureText: sameText,
        prevHash: hash,
        prevAtMs: 0,
        nowMs: 31_000
      });
      expect(r.status).toBe('idle');
    });

    it('returns null (cannot decide) when hash unchanged but not yet stale', () => {
      const sameText = 'recent prompt';
      const hash = hashCaptureOutput(sameText);
      const r = deriveStateFromFingerprint({
        captureText: sameText,
        prevHash: hash,
        prevAtMs: 0,
        nowMs: 10_000
      });
      expect(r.status).toBeNull();
    });

    it('returns the SHA256 hash + hashChanged + ageMs evidence on every call', () => {
      const r = deriveStateFromFingerprint({
        captureText: 'x',
        prevHash: 'y',
        prevAtMs: 1,
        nowMs: 100
      });
      expect(r.hash.length).toBe(64);
      expect(r.evidence.hashChanged).toBe(true);
      expect(r.evidence.ageMs).toBe(99);
    });
  });

  describe('decideAgentStatus priority cascade', () => {
    const freshFingerprintWorking: FingerprintDecision = {
      status: 'working',
      hash: 'h',
      evidence: { hashChanged: true, ageMs: 1000 }
    };

    // Cascade INVERTED in asks-as-pill JWPK 2026-05-22: hook PRIMARY now.
    it('hook PRIMARY: hook decision wins over a competing fingerprint (post-inversion anchor)', () => {
      const r = decideAgentStatus({
        fingerprint: freshFingerprintWorking,
        hookPush: { status: 'idle', nonceValid: true, ageMs: 100 },
        antActivity: null,
        pidCpu: null
      });
      expect(r.status).toBe('idle');
      expect(r.source).toBe('hook');
    });

    it('fingerprint fallback: fingerprint used when hook absent/stale', () => {
      const r = decideAgentStatus({
        fingerprint: { status: 'thinking', hash: 'h', evidence: { hashChanged: true, ageMs: 1000 } },
        hookPush: null,
        antActivity: null,
        pidCpu: null
      });
      expect(r.status).toBe('thinking');
      expect(r.source).toBe('fingerprint');
    });

    it('hook ignored when nonce invalid OR push too old', () => {
      const expiredHook = decideAgentStatus({
        fingerprint: null,
        hookPush: { status: 'working', nonceValid: true, ageMs: 60_000 },
        antActivity: null,
        pidCpu: null
      });
      expect(expiredHook.source).not.toBe('hook');

      const badNonce = decideAgentStatus({
        fingerprint: null,
        hookPush: { status: 'working', nonceValid: false, ageMs: 100 },
        antActivity: null,
        pidCpu: null
      });
      expect(badNonce.source).not.toBe('hook');
    });

    it('ANT activity TERTIARY: recent message + recent pty → working via ant-activity', () => {
      const r = decideAgentStatus({
        fingerprint: null,
        hookPush: null,
        antActivity: { lastMessageAgeMs: 5000, lastPtyAgeMs: 5000 },
        pidCpu: null
      });
      expect(r.status).toBe('working');
      expect(r.source).toBe('ant-activity');
    });

    it('ANT activity: recent message only → response-required (probably typing)', () => {
      const r = decideAgentStatus({
        fingerprint: null,
        hookPush: null,
        antActivity: { lastMessageAgeMs: 5000, lastPtyAgeMs: null },
        pidCpu: null
      });
      expect(r.status).toBe('response-required');
      expect(r.source).toBe('ant-activity');
    });

    it('PID CPU TIEBREAKER: high CPU → thinking', () => {
      const r = decideAgentStatus({
        fingerprint: null,
        hookPush: null,
        antActivity: null,
        pidCpu: { cpuPercent: 60, samplesValid: true }
      });
      expect(r.status).toBe('thinking');
      expect(r.source).toBe('pid-cpu');
    });

    it('PID CPU TIEBREAKER: low CPU → idle', () => {
      const r = decideAgentStatus({
        fingerprint: null,
        hookPush: null,
        antActivity: null,
        pidCpu: { cpuPercent: 5, samplesValid: true }
      });
      expect(r.status).toBe('idle');
      expect(r.source).toBe('pid-cpu');
    });

    it('DEFAULT idle: all sources null → idle / default', () => {
      const r = decideAgentStatus({ fingerprint: null, hookPush: null, antActivity: null, pidCpu: null });
      expect(r.status).toBe('idle');
      expect(r.source).toBe('default');
    });
  });
});
