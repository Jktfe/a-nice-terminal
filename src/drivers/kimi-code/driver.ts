// ANT — KimiCodeDriver
// File: src/drivers/kimi-code/driver.ts
//
// Prototype structured driver for Moonshot Kimi Code CLI.
// Kimi is not installed locally yet; this driver is based on official docs for
// `kimi --print --output-format=stream-json` and awaits a local probe.

import type {
  AgentDriver,
  EventClass,
  NormalisedEvent,
  RawEvent,
  RawOutput,
  UserChoice,
} from '../../fingerprint/types.js';

export interface KimiEvent extends NormalisedEvent {
  class: EventClass;
  payload: Record<string, unknown>;
}

export class KimiCodeDriver implements AgentDriver {
  detect(raw: RawEvent): NormalisedEvent | null {
    const parsed = parseJson(raw.text);
    if (!parsed) return null;

    if (parsed.role === 'assistant' && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      return this.makeEvent(raw, 'progress', {
        phase: 'tool_call',
        tool_calls: parsed.tool_calls,
      });
    }
    if (parsed.role === 'tool') {
      return this.makeEvent(raw, 'progress', {
        phase: 'tool_result',
        tool_call_id: parsed.tool_call_id,
      });
    }
    if (parsed.role === 'assistant') {
      return this.makeEvent(raw, 'progress', { phase: 'assistant_message' });
    }

    return null;
  }

  async respond(_event: NormalisedEvent, _choice: UserChoice): Promise<void> {
    // Kimi stream-json/ACP integration should respond through stdin/protocol
    // transport, not keyboard emulation. The transport adapter will own this.
  }

  isSettled(_event: NormalisedEvent, output: RawOutput): boolean {
    const lastJson = output.lines.slice().reverse().map((line) => parseJson(line.text)).find(Boolean);
    return lastJson?.role === 'assistant' && !Array.isArray(lastJson.tool_calls);
  }

  private makeEvent(raw: RawEvent, eventClass: EventClass, payload: Record<string, unknown>): KimiEvent {
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
