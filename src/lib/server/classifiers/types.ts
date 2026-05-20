/**
 * Output-classifier types per terminals-output-classifier-design-2026-05-14
 * (Layer B). 6-kind durable contract aligned to FRONT-T2 design.
 */

export type ClassifiedKind = 'raw' | 'message' | 'thinking' | 'tool_call' | 'command' | 'agent_prompt';
export type ClassifiedTrust = 'high' | 'medium' | 'raw';

export type ClassifiedEvent = {
  kind: ClassifiedKind;
  text: string;
  trust: ClassifiedTrust;
};

export type ClassifyResult = {
  events: ClassifiedEvent[];
  remaining: string;
};

export type Classifier = (buffer: string) => ClassifyResult;
