import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('read receipt identity wiring', () => {
  it('does not hard-code room ownership as the reader identity', () => {
    const roomPageSource = readFileSync('src/routes/rooms/[roomId]/+page.svelte', 'utf8');
    const messageListSource = readFileSync('src/lib/components/MessageList.svelte', 'utf8');
    const messageRowSource = readFileSync('src/lib/components/MessageRow.svelte', 'utf8');
    const indicatorSource = readFileSync('src/lib/components/MessageReadIndicator.svelte', 'utf8');

    expect(roomPageSource).not.toContain('asHandle={roomFromServer.whoCreatedIt}');
    expect(messageListSource).toContain('asHandle?: string');
    expect(messageListSource).toContain('{asHandle}');
    expect(messageListSource).toContain('readReceiptEvent?:');
    expect(messageListSource).toContain('{readReceiptEvent}');
    expect(messageRowSource).toContain('asHandle?: string');
    expect(messageRowSource).toContain('readReceiptEvent?:');
    expect(messageRowSource).toContain('<MessageReadIndicator roomId={message.roomId} messageId={message.id} {asHandle} {readReceiptEvent} />');
    expect(messageRowSource).toContain("message.body.startsWith('Open ask answered by ')");
    expect(messageRowSource).toContain('{#if isAnsweredAskReceipt}');
    expect(indicatorSource).not.toContain("asHandle = '@you'");
    expect(indicatorSource).toContain('...(asHandle ? { readerHandle: asHandle } : {})');
    expect(indicatorSource).toContain("readReceiptEvent?.type === 'message_read'");
    expect(roomPageSource).toContain('readReceiptEvent={latestRealtimeEvent}');
  });
});
