/**
 * Wire-shape for a CliAgentHandle on the API surface. Shared between
 * `/api/cli-agents`, `/api/chat-rooms/:roomId/active-cli-agents`, and any
 * future agent listing endpoint so handlers can't drift in shape.
 */

import type { CliAgentHandle } from './cliAgentRegistry';

export type SerialisedCliAgent = {
  handleId: string;
  cli: 'codex' | 'pi';
  cwd: string | null;
  roomId: string | null;
  spawnedAtMs: number;
  sessionId: string | null;
};

export function serialiseCliAgent(handle: CliAgentHandle): SerialisedCliAgent {
  return {
    handleId: handle.handleId,
    cli: handle.cli,
    cwd: handle.cwd,
    roomId: handle.roomId,
    spawnedAtMs: handle.spawnedAtMs,
    sessionId: handle.getSessionId()
  };
}
