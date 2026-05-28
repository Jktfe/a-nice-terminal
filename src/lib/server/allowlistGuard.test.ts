import { describe, it, expect } from 'vitest';
import { canCallerActOnTerminal, OPERATOR_HANDLE } from './allowlistGuard';
import type { TerminalRecord } from './terminalRecordsStore';

function rec(partial: Partial<TerminalRecord>): TerminalRecord {
  return {
    session_id: 't_x', name: 'x',
    auto_forward_room_id: null, auto_forward_chat: 1,
    agent_kind: null, tmux_target_pane: null,
    linked_chat_room_id: null,
    created_by: null, allowlist: null, handle: null,
    created_at_ms: 0, updated_at_ms: 0,
    superseded_at_ms: null,
    ...partial
  };
}

describe('allowlistGuard', () => {
  // CVE FIX B (2026-05-20): the `@you` operator-shortcut was removed
  // from the pure guard so a body-supplied `@you` claim can never
  // silently widen access. The operator-bypass now lives at the route
  // layer, keyed off server-resolved identity. Here the guard only
  // permits explicit membership.
  it('treats @you like any other handle — no longer auto-allowed', () => {
    expect(canCallerActOnTerminal(OPERATOR_HANDLE, rec({ created_by: '@alice' }))).toBe(false);
    expect(canCallerActOnTerminal(OPERATOR_HANDLE, rec({ created_by: '@alice', allowlist: '["@bob"]' }))).toBe(false);
  });

  it('still allows @you when @you is the creator', () => {
    expect(canCallerActOnTerminal(OPERATOR_HANDLE, rec({ created_by: OPERATOR_HANDLE }))).toBe(true);
  });

  it('still allows @you when listed in the allowlist', () => {
    expect(canCallerActOnTerminal(OPERATOR_HANDLE, rec({ created_by: '@alice', allowlist: '["@you"]' }))).toBe(true);
  });

  it('allows the creator', () => {
    expect(canCallerActOnTerminal('@alice', rec({ created_by: '@alice' }))).toBe(true);
  });

  it('allows a handle in the allowlist', () => {
    expect(canCallerActOnTerminal('@bob', rec({ created_by: '@alice', allowlist: '["@bob","@carol"]' }))).toBe(true);
    expect(canCallerActOnTerminal('@carol', rec({ created_by: '@alice', allowlist: '["@bob","@carol"]' }))).toBe(true);
  });

  it('denies a handle not in the allowlist (and not creator)', () => {
    expect(canCallerActOnTerminal('@dave', rec({ created_by: '@alice', allowlist: '["@bob"]' }))).toBe(false);
  });

  it('denies when created_by is null and caller is not in allowlist', () => {
    expect(canCallerActOnTerminal('@alice', rec({ created_by: null }))).toBe(false);
  });

  it('denies empty/null caller handle', () => {
    expect(canCallerActOnTerminal('', rec({ created_by: '@alice' }))).toBe(false);
    expect(canCallerActOnTerminal(null, rec({ created_by: '@alice' }))).toBe(false);
    expect(canCallerActOnTerminal(undefined, rec({ created_by: '@alice' }))).toBe(false);
  });

  it('handles malformed allowlist JSON gracefully (no crash, falls back to creator only)', () => {
    expect(canCallerActOnTerminal('@bob', rec({ created_by: '@alice', allowlist: 'not-json' }))).toBe(false);
    expect(canCallerActOnTerminal('@alice', rec({ created_by: '@alice', allowlist: 'not-json' }))).toBe(true);
  });
});
