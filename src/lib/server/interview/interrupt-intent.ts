// Interview Mode — Interrupt Intent
//
// M2 #3: when a human interrupts an agent mid-generation in an interview-mode
// linked chat, the server captures the partial output and constructs a
// structured "interrupt intent" payload that the agent receives as its next
// turn. This module owns the on-the-wire shape of that payload so the server,
// the agent driver, and any consumer (audit, replay, UI) all agree.
//
// The payload is JSON-serialisable and version-tagged. New optional fields
// can be added without breaking older parsers; required field changes
// require bumping the schema version.

export const INTERRUPT_INTENT_VERSION = 1 as const;

export interface InterruptIntent {
  schema_version: typeof INTERRUPT_INTENT_VERSION;
  original_prompt: string;
  partial_output: string;
  interrupt_message: string;
  interrupted_at_ms: number;
  // Identifiers carried through so audit can correlate without re-resolving.
  linked_chat_id: string;
  agent_handle: string | null;
}

export interface InterruptIntentInput {
  originalPrompt: string;
  partialOutput: string;
  interruptMessage: string;
  linkedChatId: string;
  agentHandle?: string | null;
  interruptedAtMs?: number;
}

export function buildInterruptIntent(input: InterruptIntentInput): InterruptIntent {
  if (typeof input.originalPrompt !== 'string') {
    throw new Error('originalPrompt is required and must be a string');
  }
  if (typeof input.partialOutput !== 'string') {
    throw new Error('partialOutput is required and must be a string');
  }
  if (typeof input.interruptMessage !== 'string' || input.interruptMessage.trim().length === 0) {
    throw new Error('interruptMessage is required and must be a non-empty string');
  }
  if (typeof input.linkedChatId !== 'string' || input.linkedChatId.length === 0) {
    throw new Error('linkedChatId is required');
  }
  return {
    schema_version: INTERRUPT_INTENT_VERSION,
    original_prompt: input.originalPrompt,
    partial_output: input.partialOutput,
    interrupt_message: input.interruptMessage,
    interrupted_at_ms: input.interruptedAtMs ?? Date.now(),
    linked_chat_id: input.linkedChatId,
    agent_handle: input.agentHandle ?? null,
  };
}

export function serializeInterruptIntent(intent: InterruptIntent): string {
  return JSON.stringify(intent);
}

// Parse a payload back into a strongly-typed intent. Returns null on
// any structural mismatch — callers decide whether to log, drop, or
// surface a parse error. Never throws on malformed input; throwing
// would make the audit replay path fragile.
export function parseInterruptIntent(raw: unknown): InterruptIntent | null {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.schema_version !== INTERRUPT_INTENT_VERSION) return null;
  if (typeof o.original_prompt !== 'string') return null;
  if (typeof o.partial_output !== 'string') return null;
  if (typeof o.interrupt_message !== 'string') return null;
  if (typeof o.interrupted_at_ms !== 'number') return null;
  if (typeof o.linked_chat_id !== 'string') return null;
  const agentHandle = o.agent_handle;
  if (agentHandle !== null && typeof agentHandle !== 'string') return null;
  return {
    schema_version: INTERRUPT_INTENT_VERSION,
    original_prompt: o.original_prompt,
    partial_output: o.partial_output,
    interrupt_message: o.interrupt_message,
    interrupted_at_ms: o.interrupted_at_ms,
    linked_chat_id: o.linked_chat_id,
    agent_handle: agentHandle ?? null,
  };
}

// Render the intent as the prompt fragment a CLI agent receives. Kept here
// so every CLI driver shim formats the same surface — change the wording in
// one place and every agent sees the same structured frame.
export function renderInterruptPrompt(intent: InterruptIntent): string {
  const lines: string[] = [];
  lines.push('[interview-mode interrupt]');
  lines.push('');
  lines.push('Original prompt:');
  lines.push(intent.original_prompt);
  lines.push('');
  if (intent.partial_output.length > 0) {
    lines.push('Your partial output before interruption:');
    lines.push(intent.partial_output);
    lines.push('');
  }
  lines.push('Interrupt from human:');
  lines.push(intent.interrupt_message);
  lines.push('');
  lines.push('Decide: incorporate the interrupt, restart from scratch, or continue. State which.');
  return lines.join('\n');
}
