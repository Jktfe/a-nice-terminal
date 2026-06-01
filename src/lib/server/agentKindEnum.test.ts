import { describe, expect, it } from 'vitest';
import {
  isValidClientAgentKind,
  isValidAnyAgentKind,
  AGENT_KINDS_CLIENT_INPUT,
  AGENT_KINDS_SERVER_RESERVED,
  AGENT_KIND_ALIAS_MAP
} from './agentKindEnum';

describe('agentKindEnum', () => {
  it('validates client input kinds', () => {
    expect(isValidClientAgentKind('claude_code')).toBe(true);
    expect(isValidClientAgentKind('codex_cli')).toBe(true);
    expect(isValidClientAgentKind('remote')).toBe(false);
    expect(isValidClientAgentKind('browser')).toBe(false);
    expect(isValidClientAgentKind('unknown')).toBe(false);
    expect(isValidClientAgentKind('not-a-kind')).toBe(false);
    expect(isValidClientAgentKind(123)).toBe(false);
  });

  it('validates any agent kind', () => {
    expect(isValidAnyAgentKind('claude_code')).toBe(true);
    expect(isValidAnyAgentKind('remote')).toBe(true);
    expect(isValidAnyAgentKind('browser')).toBe(true);
    expect(isValidAnyAgentKind('unknown')).toBe(true);
    expect(isValidAnyAgentKind('not-a-kind')).toBe(false);
  });

  it('client input set does not include reserved', () => {
    expect(AGENT_KINDS_CLIENT_INPUT.has('remote')).toBe(false);
    expect(AGENT_KINDS_CLIENT_INPUT.has('browser')).toBe(false);
  });

  it('alias map contains codex → codex_cli', () => {
    expect(AGENT_KIND_ALIAS_MAP['codex']).toBe('codex_cli');
  });
});
