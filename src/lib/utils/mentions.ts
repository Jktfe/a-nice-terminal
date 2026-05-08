export interface MentionHandle {
  handle: string;
  name: string;
}

function normaliseHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function isHandleBoundary(ch: string | undefined): boolean {
  return !ch || !/[A-Za-z0-9_.-]/.test(ch);
}

function isBracketed(text: string, index: number, handleLength: number): boolean {
  return text[index - 1] === '[' && text[index + handleLength] === ']';
}

function findActiveHandle(text: string, handle: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerHandle = handle.toLowerCase();
  let index = lowerText.indexOf(lowerHandle);

  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + handle.length];
    if (isHandleBoundary(before) && isHandleBoundary(after) && !isBracketed(text, index, handle.length)) {
      return true;
    }
    index = lowerText.indexOf(lowerHandle, index + handle.length);
  }

  return false;
}

export function activeRoutingMentions(text: string, handles: MentionHandle[]): MentionHandle[] {
  return handles.filter((item) => findActiveHandle(text, normaliseHandle(item.handle)));
}

export function mentionLiteralMatchesHandle(typedMention: string, selectedHandle: string): boolean {
  const typed = typedMention.trim();
  const selected = selectedHandle.trim();
  if (!typed || !selected) return false;
  return normaliseHandle(typed).toLowerCase() === normaliseHandle(selected).toLowerCase();
}

export function shouldCompleteMentionOnEnter(input: {
  typedMention: string | null;
  selectedHandle: string | null;
  navigated: boolean;
}): boolean {
  if (input.navigated) return true;
  if (!input.typedMention || !input.selectedHandle) return true;
  return !mentionLiteralMatchesHandle(input.typedMention, input.selectedHandle);
}

export function ensureTrailingMentionBoundary(text: string): string {
  if (/\s$/.test(text)) return text;
  return /(?:^|\s)@[\w.-]+$/.test(text) ? `${text} ` : text;
}

export function bracketRoutingMention(text: string, rawHandle: string): string {
  const handle = normaliseHandle(rawHandle);
  const lowerText = text.toLowerCase();
  const lowerHandle = handle.toLowerCase();
  let index = lowerText.indexOf(lowerHandle);
  let cursor = 0;
  let next = '';

  while (index !== -1) {
    next += text.slice(cursor, index);
    const original = text.slice(index, index + handle.length);
    const before = text[index - 1];
    const after = text[index + handle.length];
    const active = isHandleBoundary(before) && isHandleBoundary(after) && !isBracketed(text, index, handle.length);

    next += active ? `[${original}]` : original;
    cursor = index + handle.length;
    index = lowerText.indexOf(lowerHandle, cursor);
  }

  return next + text.slice(cursor);
}
