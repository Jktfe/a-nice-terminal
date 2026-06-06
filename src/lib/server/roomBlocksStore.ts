/**
 * roomBlocksStore — blocks as ANT's addressable unit of room memory.
 *
 * A room's history is segmented by context breaks (`system-break` messages)
 * into BLOCKS. Agents live in the current (open) block — they only see messages
 * since the last break — but ANY block is an addressable section an agent can
 * look up, read, and summarise on demand. The break that ENDS a block is its
 * cover (a rich state-board snapshot, stored in roomBlockStateStore).
 *
 * Blocks are DERIVED from the message stream, not stored: the boundaries are the
 * break post_orders, so a block is always consistent with the live messages.
 * The only per-block STATE (deleted tombstone, snapshot cover) lives in
 * roomBlockStateStore and is joined in here.
 *
 * Read semantics (the "don't pollute research" rule):
 *   - a DELETED message (chat_messages.deleted_at_ms) is skipped by default.
 *   - a DELETED block (room_block_state) is skipped by default.
 *   - `includeDeleted` widens both for the audit / "show everything" view.
 *
 * Block identity: blockId = the id of the break that SEALS the block. The
 * trailing open block has blockId `OPEN_BLOCK_ID` and cannot be deleted (nothing
 * seals it yet).
 */

import { listMessagesInRoom, type ChatMessage } from './chatMessageStore';
import { getBlockState, isBlockDeleted } from './roomBlockStateStore';

export const OPEN_BLOCK_ID = '__open__';

export type BlockSummary = {
  /** 0-based position; block 0 is everything before the first break. */
  index: number;
  /** Sealing break message id, or OPEN_BLOCK_ID for the trailing open block. */
  blockId: string;
  /** True for the trailing block after the last break (not yet sealed). */
  open: boolean;
  /** True if this block is tombstoned (skipped in normal reads). */
  deleted: boolean;
  /** The break's human reason (parsed from the break body), null for the open block. */
  breakReason: string | null;
  /** When the sealing break was posted (ISO), null for the open block. */
  sealedAt: string | null;
  /** Count of non-deleted, non-break messages in the block. */
  messageCount: number;
  /** True once a state-board snapshot has been captured for the block. */
  hasSnapshot: boolean;
};

/** "Context break by @x: switching lane" / "Context break by @x." → "switching lane" | null */
function parseBreakReason(body: string): string | null {
  const m = body.match(/^Context break by [^:]+:\s*(.+)$/s);
  return m ? m[1].trim() : null;
}

/** Partition a room's messages into ordered blocks by the break boundaries. */
function partition(roomId: string): Array<{ summary: Omit<BlockSummary, 'messageCount' | 'deleted' | 'hasSnapshot'>; messages: ChatMessage[] }> {
  const all = listMessagesInRoom(roomId).slice().sort((a, b) => a.postOrder - b.postOrder);
  const out: Array<{ summary: Omit<BlockSummary, 'messageCount' | 'deleted' | 'hasSnapshot'>; messages: ChatMessage[] }> = [];
  let current: ChatMessage[] = [];
  let index = 0;
  for (const msg of all) {
    if (msg.kind === 'system-break') {
      // this break seals the block accumulated so far
      out.push({
        summary: { index, blockId: msg.id, open: false, breakReason: parseBreakReason(msg.body), sealedAt: msg.postedAt },
        messages: current
      });
      current = [];
      index += 1;
    } else {
      current.push(msg);
    }
  }
  // trailing open block (always present, even if empty)
  out.push({ summary: { index, blockId: OPEN_BLOCK_ID, open: true, breakReason: null, sealedAt: null }, messages: current });
  return out;
}

/** List every block in the room, oldest first, with its derived + stored state. */
export function listBlocks(roomId: string): BlockSummary[] {
  return partition(roomId).map(({ summary, messages }) => {
    const deleted = summary.open ? false : isBlockDeleted(roomId, summary.blockId);
    const state = summary.open ? null : getBlockState(roomId, summary.blockId);
    return {
      ...summary,
      deleted,
      messageCount: messages.filter((m) => m.deletedAtMs == null).length,
      hasSnapshot: state?.snapshot_json != null
    };
  });
}

export type ReadBlockOptions = {
  /** Include deleted messages AND deleted blocks (audit view). Default false. */
  includeDeleted?: boolean;
};

/**
 * Read a single block's messages — the "look up and read a previous section so
 * I can summarise it" primitive. Returns null if the block id is unknown.
 * Deleted messages (and, if the whole block is tombstoned, all of them) are
 * excluded unless includeDeleted is set.
 */
export function readBlock(
  roomId: string,
  blockId: string,
  options: ReadBlockOptions = {}
): { block: BlockSummary; messages: ChatMessage[] } | null {
  const includeDeleted = options.includeDeleted ?? false;
  const parts = partition(roomId);
  const found = parts.find((p) => p.summary.blockId === blockId);
  if (!found) return null;

  const deletedBlock = found.summary.open ? false : isBlockDeleted(roomId, blockId);
  const state = found.summary.open ? null : getBlockState(roomId, blockId);
  const block: BlockSummary = {
    ...found.summary,
    deleted: deletedBlock,
    messageCount: found.messages.filter((m) => m.deletedAtMs == null).length,
    hasSnapshot: state?.snapshot_json != null
  };

  if (deletedBlock && !includeDeleted) return { block, messages: [] };
  const messages = includeDeleted ? found.messages : found.messages.filter((m) => m.deletedAtMs == null);
  return { block, messages };
}

/**
 * The current (open) block's messages — what an agent sees by default and what
 * search scopes to unless "all content" is requested. Convenience over
 * readBlock(OPEN_BLOCK_ID).
 */
export function readCurrentBlock(roomId: string, options: ReadBlockOptions = {}): ChatMessage[] {
  return readBlock(roomId, OPEN_BLOCK_ID, options)?.messages ?? [];
}
