/**
 * events/bus.ts — in-process typed event bus for the ANT daemon.
 *
 * Replaces HTTP polling between daemon subsystems with synchronous
 * in-process delivery. Latency drops from ~3 000 ms poll cycles to
 * microseconds. No network stack, no serialisation overhead.
 *
 * Events
 * ──────
 * message:new      — a message was written to the DB (any session)
 * terminal:output  — a PTY produced output bytes (any session)
 * task:updated     — a task row changed status
 * session:activated — the "active" session changed
 */

import { EventEmitter } from "node:events";

// ─── Payload types ────────────────────────────────────────────────────────────

export interface NewMessagePayload {
  sessionId: string;
  id: string;
  role: string;
  content: string;
  sender_name?: string | null;
  sender_type?: string | null;
  created_at: string;
}

export interface TerminalOutputPayload {
  sessionId: string;
  /** Raw PTY data (may contain ANSI sequences). */
  data: string;
}

export interface TaskUpdatedPayload {
  taskId: string;
  sessionId: string;
  status: string;
}

// ─── Typed event map ──────────────────────────────────────────────────────────

interface DaemonEvents {
  "message:new": (payload: NewMessagePayload) => void;
  "terminal:output": (payload: TerminalOutputPayload) => void;
  "task:updated": (payload: TaskUpdatedPayload) => void;
  "session:activated": (sessionId: string) => void;
}

// ─── Typed emitter ────────────────────────────────────────────────────────────

class DaemonEventBus extends EventEmitter {
  emit<K extends keyof DaemonEvents>(
    event: K,
    ...args: Parameters<DaemonEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof DaemonEvents>(event: K, listener: DaemonEvents[K]): this {
    return super.on(event, listener);
  }

  once<K extends keyof DaemonEvents>(event: K, listener: DaemonEvents[K]): this {
    return super.once(event, listener);
  }

  off<K extends keyof DaemonEvents>(event: K, listener: DaemonEvents[K]): this {
    return super.off(event, listener);
  }
}

export const bus = new DaemonEventBus();
// Raise the listener limit — Chair + bridge + monitor + watchdog all subscribe.
bus.setMaxListeners(20);
