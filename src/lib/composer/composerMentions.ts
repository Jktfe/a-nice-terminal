/**
 * Pure helpers for @ mention detection and ranking in the chat composer.
 *
 * Backs M03 slice 4 (wireframe board WTHef h05 — alias-aware mention).
 * No SOURCE: this is fresh code, no in-repo lift to audit.
 *
 * Detection scope: any-position @ token. The trigger fires as soon as @ is
 * typed (bare @ shows the full member list); it dismisses if whitespace
 * follows the @. Aliases rank above global handles when both match.
 */

import type { RoomMember } from '$lib/server/chatRoomStore';
import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';

export type MentionTrigger = {
  partialTyped: string;
  startIndexInBody: number;
  endIndexInBody: number;
};

export type MentionOption = {
  handleToInsert: string;
  displayLabel: string;
  contextHint: string;
  optionKind: 'alias' | 'global' | 'broadcast';
};

const EVERYONE_OPTION: MentionOption = {
  handleToInsert: '@everyone',
  displayLabel: '@everyone',
  contextHint: 'broadcast — direct route to all room members',
  optionKind: 'broadcast'
};

export type MentionKeyResult =
  | { action: 'navigate-down' }
  | { action: 'navigate-up' }
  | { action: 'insert'; handleToInsert: string }
  | { action: 'dismiss' }
  | { action: 'pass-through' };

export function detectMentionTrigger(body: string, cursorIndex: number): MentionTrigger | null {
  const upToCursor = body.slice(0, cursorIndex);
  const atIndex = upToCursor.lastIndexOf('@');
  if (atIndex === -1) return null;

  const charJustBeforeAt = atIndex === 0 ? '' : upToCursor.charAt(atIndex - 1);
  const startsLineOrFollowsSpace = charJustBeforeAt === '' || /\s/.test(charJustBeforeAt);
  if (!startsLineOrFollowsSpace) return null;

  const partialAfterAt = upToCursor.slice(atIndex + 1);
  if (/\s/.test(partialAfterAt)) return null;

  return {
    partialTyped: partialAfterAt,
    startIndexInBody: atIndex,
    endIndexInBody: cursorIndex
  };
}

export function rankMentionOptions(
  membersInRoom: RoomMember[],
  aliasEntries: RoomAliasEntry[],
  partialTyped: string
): MentionOption[] {
  const needleLower = partialTyped.toLowerCase();

  const aliasOptions: MentionOption[] = aliasEntries
    .filter((entry) => entry.alias.toLowerCase().includes(needleLower))
    .map((entry) => ({
      handleToInsert: entry.alias,
      displayLabel: entry.alias,
      contextHint: `alias for ${entry.globalHandle}`,
      optionKind: 'alias'
    }));

  const handlesAlreadyShownAsAlias = new Set(aliasEntries.map((entry) => entry.globalHandle));

  const globalOptions: MentionOption[] = membersInRoom
    .filter((member) => member.handle.toLowerCase().includes(needleLower))
    .filter((member) => !handlesAlreadyShownAsAlias.has(member.handle))
    .map((member) => ({
      handleToInsert: member.handle,
      displayLabel: member.handle,
      contextHint: member.kind === 'agent' ? 'agent' : 'person',
      optionKind: 'global'
    }));

  const broadcastOptions: MentionOption[] = 'everyone'.includes(needleLower) ? [EVERYONE_OPTION] : [];

  return [...broadcastOptions, ...aliasOptions, ...globalOptions];
}

export function decideMentionKeyAction(
  pressedKey: string,
  options: MentionOption[],
  activeIndex: number
): MentionKeyResult {
  if (options.length === 0) {
    if (pressedKey === 'Escape') return { action: 'dismiss' };
    return { action: 'pass-through' };
  }
  if (pressedKey === 'ArrowDown') return { action: 'navigate-down' };
  if (pressedKey === 'ArrowUp') return { action: 'navigate-up' };
  if (pressedKey === 'Enter' || pressedKey === 'Tab') {
    const safeActiveIndex =
      activeIndex >= 0 && activeIndex < options.length ? activeIndex : 0;
    return { action: 'insert', handleToInsert: options[safeActiveIndex].handleToInsert };
  }
  if (pressedKey === 'Escape') return { action: 'dismiss' };
  return { action: 'pass-through' };
}

export function spliceMentionPick(
  body: string,
  trigger: MentionTrigger,
  handleToInsert: string
): { newBody: string; newCursorIndex: number } {
  const before = body.slice(0, trigger.startIndexInBody);
  const after = body.slice(trigger.endIndexInBody);
  const inserted = `${handleToInsert} `;
  const newBody = before + inserted + after;
  const newCursorIndex = before.length + inserted.length;
  return { newBody, newCursorIndex };
}
