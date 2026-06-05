import type { ChatMessage } from './chatMessageStore';
import { isDurableMemberHandle } from './membershipStore';

export type VisibleContentSkipReason =
  | 'non_current_block'
  | 'message_deleted'
  | 'block_deleted'
  | 'synthetic_browser_session';

export type VisibleContentScope = {
  /**
   * When present, only these message ids belong to the visible block. Omit it
   * for deliberate all-content reads; deletion and synthetic filtering still
   * applies.
   */
  currentBlockIds?: Set<string>;
  /** Reserved for the per-block tombstone slice. */
  deletedBlockIds?: Set<string>;
};

export function visibleContentSkipReason(
  message: ChatMessage,
  scope: VisibleContentScope
): VisibleContentSkipReason | null {
  if (message.deletedAtMs !== undefined && message.deletedAtMs !== null) return 'message_deleted';
  if (!isDurableMemberHandle(message.authorHandle)) return 'synthetic_browser_session';
  if (scope.currentBlockIds !== undefined && !scope.currentBlockIds.has(message.id)) {
    return 'non_current_block';
  }
  return null;
}

export function filterVisibleMessages(
  messages: ChatMessage[],
  scope: VisibleContentScope
): ChatMessage[] {
  return messages.filter((message) => visibleContentSkipReason(message, scope) === null);
}
