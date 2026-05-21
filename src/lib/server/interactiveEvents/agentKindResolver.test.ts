import { describe, it, expect, beforeEach, vi } from 'vitest';

const m3Rows = new Map<string, { agent_kind: string | null }>();
const trRows = new Map<string, { agent_kind: string | null }>();

vi.mock('../db', () => ({
  getIdentityDb: () => ({
    prepare: (sql: string) => ({
      get: (id: string) => sql.includes('FROM terminals WHERE') ? m3Rows.get(id) : trRows.get(id)
    })
  })
}));

const { resolveAgentKind } = await import('./agentKindResolver');

describe('resolveAgentKind', () => {
  beforeEach(() => { m3Rows.clear(); trRows.clear(); });

  it('returns null when neither table has a row', () => {
    expect(resolveAgentKind('missing')).toBeNull();
  });

  it('returns null when both tables have null agent_kind', () => {
    m3Rows.set('s1', { agent_kind: null });
    trRows.set('s1', { agent_kind: null });
    expect(resolveAgentKind('s1')).toBeNull();
  });

  it('passes claude-code through unchanged from terminals (M3.x)', () => {
    m3Rows.set('s2', { agent_kind: 'claude-code' });
    expect(resolveAgentKind('s2')).toBe('claude-code');
  });

  it('normalizes claude_code alias to claude-code from terminals', () => {
    m3Rows.set('s3', { agent_kind: 'claude_code' });
    expect(resolveAgentKind('s3')).toBe('claude-code');
  });

  it('falls back to terminal_records when terminals row absent (autodetect-wiring)', () => {
    trRows.set('s4', { agent_kind: 'claude-code' });
    expect(resolveAgentKind('s4')).toBe('claude-code');
  });

  it('falls back to terminal_records when terminals.agent_kind is null', () => {
    m3Rows.set('s5', { agent_kind: null });
    trRows.set('s5', { agent_kind: 'codex' });
    expect(resolveAgentKind('s5')).toBe('codex');
  });

  it('normalizes alias even when sourced from terminal_records', () => {
    trRows.set('s6', { agent_kind: 'claude_code' });
    expect(resolveAgentKind('s6')).toBe('claude-code');
  });

  it('returns null for empty sessionId', () => {
    expect(resolveAgentKind('')).toBeNull();
  });

  it('normalizes JWPK short label `claude` to canonical `claude-code` (T-AGENT-LIST-SETTINGS)', () => {
    m3Rows.set('s7', { agent_kind: 'claude' });
    expect(resolveAgentKind('s7')).toBe('claude-code');
  });

  it('short-label `claude` from terminal_records also normalizes', () => {
    trRows.set('s8', { agent_kind: 'claude' });
    expect(resolveAgentKind('s8')).toBe('claude-code');
  });
});
