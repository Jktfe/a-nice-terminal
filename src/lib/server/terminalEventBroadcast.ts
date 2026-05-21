/**
 * terminalEventBroadcast — globalThis pub/sub for classified terminal
 * events. Boot subscriber publishes one event per classifier output;
 * SSE handlers subscribe per-sessionId. Avoids the dual-classification
 * problem where SSE + persistence both consumed ptyClient buffers.
 */

import type { ClassifiedEvent } from './classifiers/types';

export type BroadcastedEvent = ClassifiedEvent & { ts_ms: number; source: string };
export type Subscriber = (sessionId: string, event: BroadcastedEvent) => void;

type State = { subscribers: Set<Subscriber> };

function getStore(): State {
  const g = globalThis as unknown as { __antTerminalEventBroadcast?: State };
  if (!g.__antTerminalEventBroadcast) g.__antTerminalEventBroadcast = { subscribers: new Set() };
  return g.__antTerminalEventBroadcast;
}

export function broadcastTerminalEvent(sessionId: string, event: BroadcastedEvent): void {
  const { subscribers } = getStore();
  for (const cb of subscribers) {
    try { cb(sessionId, event); } catch { /* swallow per-subscriber errors */ }
  }
}

export function subscribeTerminalEvents(cb: Subscriber): () => void {
  const { subscribers } = getStore();
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}
