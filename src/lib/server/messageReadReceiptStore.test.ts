import { beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb } from './db';
import {
  hasReaderReadMessage,
  listReadersForMessage,
  listReadersForMessages,
  markMessageRead,
  resetMessageReadReceiptStoreForTests
} from './messageReadReceiptStore';

describe('messageReadReceiptStore', () => {
  beforeEach(() => {
    resetMessageReadReceiptStoreForTests();
  });

  it('markMessageRead records a reader and returns the receipt', () => {
    const receipt = markMessageRead({ messageId: 'msg_1', readerHandle: '@you' });
    expect(receipt.messageId).toBe('msg_1');
    expect(receipt.readerHandle).toBe('@you');
    expect(receipt.readAt.length).toBeGreaterThan(0);
  });

  it('markMessageRead persists the receipt to SQLite', () => {
    markMessageRead({ messageId: 'msg_1', readerHandle: '@you' });
    const row = getIdentityDb()
      .prepare(
        `SELECT message_id, reader_handle
           FROM message_read_receipts
          WHERE message_id = ? AND reader_handle = ?`
      )
      .get('msg_1', '@you') as { message_id: string; reader_handle: string } | undefined;

    expect(row).toEqual({ message_id: 'msg_1', reader_handle: '@you' });
  });

  it('markMessageRead is idempotent — second mark returns the original receipt', () => {
    const first = markMessageRead({ messageId: 'msg_1', readerHandle: '@you' });
    const second = markMessageRead({ messageId: 'msg_1', readerHandle: '@you' });
    expect(second.readAt).toBe(first.readAt);
    expect(listReadersForMessage('msg_1')).toHaveLength(1);
  });

  it('markMessageRead trims whitespace on each field', () => {
    const receipt = markMessageRead({
      messageId: '  msg_1  ',
      readerHandle: '  @you  '
    });
    expect(receipt.messageId).toBe('msg_1');
    expect(receipt.readerHandle).toBe('@you');
  });

  it('markMessageRead rejects a blank messageId', () => {
    expect(() => markMessageRead({ messageId: '   ', readerHandle: '@you' })).toThrow();
  });

  it('markMessageRead rejects a blank readerHandle', () => {
    expect(() => markMessageRead({ messageId: 'msg_1', readerHandle: '   ' })).toThrow();
  });

  it('listReadersForMessage returns readers in mark-order', () => {
    markMessageRead({ messageId: 'msg_1', readerHandle: '@first' });
    markMessageRead({ messageId: 'msg_1', readerHandle: '@second' });
    markMessageRead({ messageId: 'msg_1', readerHandle: '@third' });
    expect(
      listReadersForMessage('msg_1').map((entry) => entry.readerHandle)
    ).toEqual(['@first', '@second', '@third']);
  });

  it('listReadersForMessage returns an empty array for an unread message', () => {
    expect(listReadersForMessage('unread')).toEqual([]);
  });

  it('listReadersForMessages groups persisted readers by message id', () => {
    markMessageRead({ messageId: 'msg_b', readerHandle: '@second' });
    markMessageRead({ messageId: 'msg_a', readerHandle: '@first' });
    markMessageRead({ messageId: 'msg_b', readerHandle: '@third' });

    expect(listReadersForMessages(['msg_a', 'msg_b', 'msg_missing'])).toEqual({
      msg_a: [expect.objectContaining({ messageId: 'msg_a', readerHandle: '@first' })],
      msg_b: [
        expect.objectContaining({ messageId: 'msg_b', readerHandle: '@second' }),
        expect.objectContaining({ messageId: 'msg_b', readerHandle: '@third' })
      ]
    });
  });

  it('listReadersForMessage returns a defensive copy (mutating it does not affect store)', () => {
    markMessageRead({ messageId: 'msg_1', readerHandle: '@you' });
    const list = listReadersForMessage('msg_1');
    list.pop();
    expect(listReadersForMessage('msg_1')).toHaveLength(1);
  });

  it('hasReaderReadMessage reflects state', () => {
    expect(hasReaderReadMessage('msg_1', '@you')).toBe(false);
    markMessageRead({ messageId: 'msg_1', readerHandle: '@you' });
    expect(hasReaderReadMessage('msg_1', '@you')).toBe(true);
    expect(hasReaderReadMessage('msg_1', '@someoneelse')).toBe(false);
  });

  it('hasReaderReadMessage is per-message', () => {
    markMessageRead({ messageId: 'msg_a', readerHandle: '@you' });
    expect(hasReaderReadMessage('msg_a', '@you')).toBe(true);
    expect(hasReaderReadMessage('msg_b', '@you')).toBe(false);
  });

  it('keeps receipts per-message independent', () => {
    markMessageRead({ messageId: 'msg_a', readerHandle: '@you' });
    markMessageRead({ messageId: 'msg_b', readerHandle: '@you' });
    expect(listReadersForMessage('msg_a')).toHaveLength(1);
    expect(listReadersForMessage('msg_b')).toHaveLength(1);
  });

  it('resetMessageReadReceiptStoreForTests clears every receipt', () => {
    markMessageRead({ messageId: 'msg_1', readerHandle: '@you' });
    resetMessageReadReceiptStoreForTests();
    expect(listReadersForMessage('msg_1')).toEqual([]);
    expect(hasReaderReadMessage('msg_1', '@you')).toBe(false);
  });
});
