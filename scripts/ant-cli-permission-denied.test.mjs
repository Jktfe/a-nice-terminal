/**
 * Tests for the Stage A CLI permission-denied renderer (plan milestone
 * p3-stage-a-403-payload of ant-substrate-v0.2-2026-05-29).
 */
import { describe, expect, it } from 'vitest';
import {
  isPermissionDeniedBody,
  renderPermissionDenied,
  renderPermissionDeniedIfPresent
} from './ant-cli-permission-denied.mjs';

function makeRuntime() {
  const lines = [];
  return {
    writeErr: (line) => lines.push(line),
    writeOut: (line) => lines.push(`OUT:${line}`),
    captured: lines
  };
}

function makePayload(overrides = {}) {
  return {
    message: 'no membership in this room',
    permission_denied: {
      action: 'chat.post',
      target_kind: 'room',
      target_id: 'orsz2321qb',
      target_display_name: 'speed matters',
      reason: 'no_membership',
      approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }],
      approve_command: 'ant grant @speedyc chat.post --room orsz2321qb',
      ...overrides.permission_denied
    },
    ...overrides
  };
}

describe('isPermissionDeniedBody', () => {
  it('returns true for a well-formed payload', () => {
    expect(isPermissionDeniedBody(makePayload())).toBe(true);
  });

  it('returns false for plain string-message 403 bodies', () => {
    expect(isPermissionDeniedBody({ message: 'Server-resolved identity required.' })).toBe(false);
  });

  it('returns false for null/undefined/non-objects', () => {
    expect(isPermissionDeniedBody(null)).toBe(false);
    expect(isPermissionDeniedBody(undefined)).toBe(false);
    expect(isPermissionDeniedBody('a string')).toBe(false);
  });

  it('returns false when required fields are missing', () => {
    expect(
      isPermissionDeniedBody({
        message: 'x',
        permission_denied: { action: 'chat.post' }
      })
    ).toBe(false);
  });
});

describe('renderPermissionDenied', () => {
  it('emits the 4 always-present lines (head + reason + approver + approve_command)', () => {
    const runtime = makeRuntime();
    renderPermissionDenied(makePayload(), runtime);
    expect(runtime.captured).toHaveLength(4);
    expect(runtime.captured[0]).toBe(
      'PermissionDenied: cannot chat.post on room speed matters'
    );
    expect(runtime.captured[1]).toBe('  Reason:      no membership in this room');
    expect(runtime.captured[2]).toBe('  Approver:    @jwpk (room_owner)');
    expect(runtime.captured[3]).toBe(
      '  Approve via: ant grant @speedyc chat.post --room orsz2321qb'
    );
  });

  it('emits approve_url line when present', () => {
    const runtime = makeRuntime();
    renderPermissionDenied(
      makePayload({
        permission_denied: {
          approve_url: 'ant://approve/req_abc',
          action: 'chat.post',
          target_kind: 'room',
          target_id: 'orsz2321qb',
          target_display_name: 'speed matters',
          reason: 'no_membership',
          approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }],
          approve_command: 'ant grant @speedyc chat.post --room orsz2321qb'
        }
      }),
      runtime
    );
    expect(runtime.captured).toContain('  Or open:     ant://approve/req_abc');
  });

  it('emits request_id line when present', () => {
    const runtime = makeRuntime();
    renderPermissionDenied(
      makePayload({
        permission_denied: {
          request_id: 'req_xyz',
          action: 'chat.post',
          target_kind: 'room',
          target_id: 'r1',
          reason: 'no_membership',
          approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }],
          approve_command: 'ant grant @speedyc chat.post --room r1'
        }
      }),
      runtime
    );
    expect(runtime.captured).toContain('  Request id:  req_xyz');
  });

  it('uses target_id when target_display_name is absent', () => {
    const runtime = makeRuntime();
    renderPermissionDenied(
      makePayload({
        permission_denied: {
          action: 'chat.post',
          target_kind: 'room',
          target_id: 'r1',
          reason: 'no_membership',
          approvers: [{ handle: '@jwpk', role: 'room_owner', preferred: true }],
          approve_command: 'ant grant @x chat.post --room r1'
        }
      }),
      runtime
    );
    expect(runtime.captured[0]).toBe('PermissionDenied: cannot chat.post on room r1');
  });

  it('renders all approvers when none are marked preferred', () => {
    const runtime = makeRuntime();
    renderPermissionDenied(
      makePayload({
        permission_denied: {
          action: 'chat.post',
          target_kind: 'room',
          target_id: 'r1',
          reason: 'no_membership',
          approvers: [
            { handle: '@a', role: 'room_owner', preferred: false },
            { handle: '@b', role: 'org_admin', preferred: false }
          ],
          approve_command: 'ant grant @x chat.post --room r1'
        }
      }),
      runtime
    );
    expect(runtime.captured[2]).toBe('  Approver:    @a (room_owner), @b (org_admin)');
  });

  it('renders a fallback approver line when the list is empty', () => {
    const runtime = makeRuntime();
    renderPermissionDenied(
      makePayload({
        permission_denied: {
          action: 'admin.restart',
          target_kind: 'system',
          target_id: 'fresh-ant',
          reason: 'not_org_admin',
          approvers: [],
          approve_command: 'ant grant @x admin.restart'
        }
      }),
      runtime
    );
    expect(runtime.captured[2]).toBe(
      '  Approver:    (none resolved — contact your org admin)'
    );
  });
});

describe('renderPermissionDeniedIfPresent', () => {
  function mockResponse(body) {
    return {
      clone() {
        return this;
      },
      json: async () => body
    };
  }

  it('renders + returns body when payload matches', async () => {
    const runtime = makeRuntime();
    const out = await renderPermissionDeniedIfPresent(
      mockResponse(makePayload()),
      runtime
    );
    expect(out).not.toBeNull();
    expect(runtime.captured.length).toBeGreaterThan(0);
  });

  it('returns null + writes nothing for a plain-message 403', async () => {
    const runtime = makeRuntime();
    const out = await renderPermissionDeniedIfPresent(
      mockResponse({ message: 'Server-resolved identity required.' }),
      runtime
    );
    expect(out).toBeNull();
    expect(runtime.captured).toHaveLength(0);
  });

  it('returns null + writes nothing when the response body is not JSON', async () => {
    const runtime = makeRuntime();
    const out = await renderPermissionDeniedIfPresent(
      {
        clone() {
          return this;
        },
        json: async () => {
          throw new Error('not json');
        }
      },
      runtime
    );
    expect(out).toBeNull();
    expect(runtime.captured).toHaveLength(0);
  });
});
