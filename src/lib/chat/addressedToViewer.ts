/**
 * Reply-badge-for-recipient derivation (New Model Team feedback #2a,
 * 2026-05-26, hs9jv51zrh msg_3fipvqu8m9 from @james via @newmodelteambot).
 *
 * Given a message + its parent (if loaded) + the viewer's handle, decide
 * whether to badge the row as addressed-to-the-viewer. Pure function so
 * MessageRow.svelte can call it from `$derived.by` and tests can pin all
 * five cases without mounting a component.
 *
 * Discriminator (not boolean) because reply vs mention are different
 * signals — reply ranks higher attention-wise + the badge copy differs.
 */

import { listBareMentionHandles } from './mentionRouting';

export type AddressedKind = 'reply' | 'mention' | null;

type MessageLite = {
  authorHandle: string;
  body: string;
};

type ParentLite = {
  authorHandle: string;
} | null | undefined;

export function resolveAddressedKind(
  message: MessageLite,
  parentMessage: ParentLite,
  asHandle: string | null | undefined
): AddressedKind {
  // No viewer or page placeholder — '@you' is the room page's default
  // when the caller handle hasn't resolved yet. A literal '@you' in
  // bodies would otherwise false-positive every message.
  if (typeof asHandle !== 'string' || asHandle.length === 0 || asHandle === '@you') {
    return null;
  }
  // Own messages never badge — the operator doesn't need to be told
  // their own message is addressed to them.
  if (asHandle === message.authorHandle) return null;
  // Reply takes precedence over mention when both fire (operator's
  // own message was the parent + the reply also @-tags them).
  if (parentMessage && parentMessage.authorHandle === asHandle) return 'reply';
  if (listBareMentionHandles(message.body).includes(asHandle)) return 'mention';
  return null;
}
