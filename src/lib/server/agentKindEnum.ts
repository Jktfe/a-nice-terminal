// agentKindEnum — single source of truth for the agent_kind enum.
// Split into client-input vs reserved vs all-DB-valid sets so registration
// routes can reject reserved kinds (remote/browser written only by internal
// stores) AND `unknown` (a detector-server-side sentinel from sourceDefault,
// never legitimate client input). M3.2d B1 cycle-break extraction so
// fingerprintDetector.ts and identity routes can both consume without cycle.

export type AgentKind =
  | 'claude_code' | 'codex_cli' | 'cursor' | 'gemini' | 'aider'
  | 'generic-shell' | 'unknown' | 'remote' | 'browser';

export const AGENT_KINDS_CLIENT_INPUT: ReadonlySet<AgentKind> = new Set<AgentKind>([
  'claude_code', 'codex_cli', 'cursor', 'gemini', 'aider', 'generic-shell'
]);

export const AGENT_KINDS_SERVER_RESERVED: ReadonlySet<AgentKind> = new Set<AgentKind>([
  'remote', 'browser'
]);

export const AGENT_KINDS_ALL: ReadonlySet<AgentKind> = new Set<AgentKind>([
  ...AGENT_KINDS_CLIENT_INPUT, ...AGENT_KINDS_SERVER_RESERVED, 'unknown'
]);

export function isValidClientAgentKind(s: unknown): s is AgentKind {
  return typeof s === 'string' && AGENT_KINDS_CLIENT_INPUT.has(s as AgentKind);
}

export function isValidAnyAgentKind(s: unknown): s is AgentKind {
  return typeof s === 'string' && AGENT_KINDS_ALL.has(s as AgentKind);
}

// Known alias map for the one-time janitor migration.
export const AGENT_KIND_ALIAS_MAP: Readonly<Record<string, AgentKind>> = {
  codex: 'codex_cli'
};
