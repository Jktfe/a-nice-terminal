import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildAttachmentMarkdownLink, uploadAttachmentToRoom } from './composerAttachments';

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

  readAsDataURL(file: File): void {
    void file.arrayBuffer().then((buffer) => {
      this.result = `data:${file.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload?.({} as ProgressEvent<FileReader>);
    }).catch((error: Error) => {
      this.error = error;
      this.onerror?.({} as ProgressEvent<FileReader>);
    });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('mints a browser session before posting the attachment', async () => {
    vi.stubGlobal('FileReader', TestFileReader);
    const callOrder: string[] = [];
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    const result = await uploadAttachmentToRoom({
      roomId: 'room42',
      file,
      uploadedByHandle: '@you',
      ensureSessionForRoom: async (input) => {
        callOrder.push(`session:${input.roomId}:${input.authorHandle}:${input.force}`);
        return { ok: true, cached: false };
      },
      fetcher: async (input, init) => {
        callOrder.push(`upload:${input}:${JSON.parse(String(init?.body)).uploadedByHandle}`);
        return new Response(JSON.stringify({
          sharedFile: {
            id: 'att1',
            filename: 'notes.txt',
            mimeType: 'text/plain',
          },
        }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    expect(callOrder).toEqual([
      'session:room42:@you:true',
      'upload:/api/chat-rooms/room42/attachments:@you',
    ]);
    expect(result.markdownLink).toBe('[📎 notes.txt](/api/chat-rooms/room42/attachments/att1)');
  });

  it('does not post the attachment when browser-session minting fails', async () => {
    vi.stubGlobal('FileReader', TestFileReader);
    const fetcher = vi.fn();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    await expect(uploadAttachmentToRoom({
      roomId: 'room42',
      file,
      uploadedByHandle: '@you',
      ensureSessionForRoom: async () => ({ ok: false, reason: 'authorHandle is not a room member', status: 403 }),
      fetcher,
    })).rejects.toThrow('Could not establish identity for @you in this room: authorHandle is not a room member');

    expect(fetcher).not.toHaveBeenCalled();
  });
});
