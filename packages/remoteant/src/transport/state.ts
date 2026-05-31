import type { ConnectionState, StateChange, TransportMode } from "./types.ts";

export { type ConnectionState, type StateChange, type TransportMode };

export function makeStateChange(
  state: ConnectionState,
  serverUrl: string,
  transportMode: TransportMode | null,
  reconnectAttempt: number,
  lastError?: string
): StateChange {
  return {
    state,
    serverUrl,
    transportMode,
    lastConnectedAtMs: Date.now(),
    reconnectAttempt,
    lastError,
  };
}
