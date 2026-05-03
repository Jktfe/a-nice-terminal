// ANT — PiDriver
// File: src/drivers/pi/driver.ts
//
// Prototype structured driver for pi-coding-agent.
// Pi exposes rich JSONL in `--mode json` and live control/state via `--mode rpc`.
// The tmux/TUI fingerprint spec is still pending, so this driver only parses
// JSONL records when they are fed into the AgentDriver pipeline.

import type {
  AgentDriver,
  EventClass,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';
import type { AgentStatus } from '../../lib/shared/agent-status.js';
import { projectPiRecord, sha256Hex } from '../../lib/server/pi-rpc/projection.js';

export interface PiEvent extends NormalisedEvent {
  class: EventClass;
  payload: Record<string, unknown>;
}

export class PiDriver implements AgentDriver {
  detect(raw: RawEvent): NormalisedEvent | null {
    const parsed = parseJson(raw.text);
    if (!parsed) return null;

    const line = raw.raw || raw.text;
    const lineBytes = Buffer.from(line, 'utf8');
    const projected = projectPiRecord(parsed, {
      start: 0,
      end: lineBytes.length,
      line: 1,
      sha256: sha256Hex(lineBytes),
    }, raw.ts);

    if (projected) {
      return this.makeEvent(raw, eventClassForRunEvent(projected.kind), {
        ...projected.payload,
        run_event_kind: projected.kind,
        run_event_source: projected.source,
        run_event_trust: projected.trust,
        run_event_text: projected.text,
        raw_ref: projected.raw_ref,
      });
    }

    return null;
  }

  async respond(_event: NormalisedEvent, _choice: UserChoice): Promise<void> {
    // Pi JSON/RPC integration should respond through its stdin/RPC transport,
    // not keyboard emulation. The transport adapter will own this.
  }

  isSettled(_event: NormalisedEvent, output: RawOutput): boolean {
    return output.lines.slice(-5).some((line) => {
      const parsed = parseJson(line.text);
      return parsed?.type === 'agent_end' || parsed?.type === 'turn_end';
    });
  }

  detectStatus(recentLines: string[]): AgentStatus | null {
    for (const line of recentLines.slice().reverse()) {
      const parsed = parseJson(line);
      if (parsed?.type !== 'response' || parsed?.command !== 'get_state') continue;
      const data = parsed.data as Record<string, any> | undefined;
      if (!data) continue;
      const model = data.model as Record<string, any> | undefined;
      return {
        model: typeof model?.id === 'string' ? model.id : undefined,
        state: data.isCompacting ? 'thinking' : data.isStreaming ? 'busy' : 'ready',
        activity: data.isCompacting ? 'Compacting context' : data.isStreaming ? 'Streaming response' : undefined,
        detectedAt: Date.now(),
      };
    }
    return null;
  }

  private makeEvent(raw: RawEvent, eventClass: EventClass, payload: Record<string, unknown>): PiEvent {
    return {
      seq: 0,
      ts: raw.ts,
      source: raw.source === 'jsonl' ? 'pty' : 'tmux',
      type: 'output',
      raw: raw.raw,
      text: raw.text,
      class: eventClass,
      payload,
    };
  }
}

function parseJson(text: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function eventClassForRunEvent(kind: string): EventClass {
  if (kind === 'approval') return 'permission_request';
  if (kind === 'agent_prompt') return 'free_text';
  return 'progress';
}
