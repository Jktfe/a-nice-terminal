/**
 * Interactive-event types per linkedchat-backend-v3-audit Layer A
 * lift (T2b). 7 EventClass values matching v3 src/fingerprint/types.ts.
 * Different concern from Layer B output classifier — Layer A detects
 * INTERACTIVE prompts (asks/auth/confirms) that need UI affordances.
 */

export type EventClass =
  | 'permission_request'
  | 'multi_choice'
  | 'confirmation'
  | 'free_text'
  | 'tool_auth'
  | 'progress'
  | 'error_retry';

export type DetectedInteractiveEvent = {
  eventClass: EventClass;
  promptText: string;
  /** Optional choices for multi_choice / confirmation kinds. */
  choices?: string[];
};

export type DetectResult = {
  events: DetectedInteractiveEvent[];
  /** Bytes the detector consumed; remainder stays in shared buffer. */
  consumedBytes: number;
};

export type Detector = (buffer: string) => DetectResult;
