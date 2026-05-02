// M3 CommandBlock — component-local RunEvent type.
//
// Aligned with src/lib/components/RunView.svelte and R4 §3a / §5.
// The canonical type belongs to @ocloudant-dev's projector lane; when it lands,
// import-swap this file's `RunEvent` for the canonical export.

export type RunEventSource =
  | 'hook'
  | 'json'
  | 'rpc'
  | 'mcp'
  | 'acp'
  | 'terminal'
  | 'status'
  | 'tmux';

export type RunEventTrust = 'high' | 'medium' | 'raw';

export type RunEventKind =
  | 'command_block'
  | 'agent_prompt'
  | 'artifact'
  // Sibling kinds rendered by RunView; CommandBlock recognises but does not own:
  | 'tool_call'
  | 'tool_result'
  | 'message'
  | 'progress'
  | 'status'
  | 'error'
  | string;

export interface RunEvent<P = Record<string, unknown>> {
  id: string;
  session_id: string;
  ts: number;
  source: RunEventSource;
  trust: RunEventTrust;
  kind: RunEventKind;
  payload?: P;
  raw_ref?: string;
}

// Payload shapes for the three M3 kinds. Permissive on optional fields so
// the projector can grow without breaking the renderer.

export interface CommandBlockPayload {
  command: string;
  cwd?: string | null;
  exit_code?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  duration_ms?: number | null;
  output?: string | null;
  output_truncated?: boolean;
}

export interface AgentPromptPayload {
  agent: string;
  prompt: string;
  options?: string[];
  prompt_id?: string;
}

export interface ArtifactPayload {
  hash: string;
  mime: string;
  bytes?: number;
  label?: string;
  caption?: string;
}

export type CommandBlockEvent = RunEvent<CommandBlockPayload> & { kind: 'command_block' };
export type AgentPromptEvent = RunEvent<AgentPromptPayload> & { kind: 'agent_prompt' };
export type ArtifactEvent = RunEvent<ArtifactPayload> & { kind: 'artifact' };
