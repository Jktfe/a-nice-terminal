import { describe, it, expect } from 'vitest';
import { buildAttachmentMarkdownLink } from './composerAttachments';

describe('buildAttachmentMarkdownLink', () => {
  it('renders an image mime type as an inline image markdown', () => {
    const link = buildAttachmentMarkdownLink({
      roomId: 'room42',
      attachmentId: 'att1',
      filename: 'shot.png',
      mimeType: 'image/png'
    });
    expect(link).toBe('![shot.png](/api/chat-rooms/room42/attachments/att1)');
  });

  it('renders a non-image mime type as a paperclip link', () => {
    const link = buildAttachmentMarkdownLink({
      roomId: 'room42',
      attachmentId: 'att2',
      filename: 'notes.txt',
      mimeType: 'text/plain'
    });
    expect(link).toBe('[📎 notes.txt](/api/chat-rooms/room42/attachments/att2)');
  });

  it('escapes markdown-special characters in the filename', () => {
    const link = buildAttachmentMarkdownLink({
      roomId: 'r',
      attachmentId: 'a',
      filename: 'tricky [name](here).pdf',
      mimeType: 'application/pdf'
    });
    expect(link).toBe('[📎 tricky \\[name\\]\\(here\\).pdf](/api/chat-rooms/r/attachments/a)');
  });

  it('url-encodes the roomId and attachmentId components', () => {
    const link = buildAttachmentMarkdownLink({
      roomId: 'room with space',
      attachmentId: 'id/slash',
      filename: 'plain.bin',
      mimeType: 'application/octet-stream'
    });
    expect(link).toContain('/api/chat-rooms/room%20with%20space/attachments/id%2Fslash');
  });
});
