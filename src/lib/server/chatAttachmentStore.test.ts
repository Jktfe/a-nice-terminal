import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findSharedFileById,
  listFilesSharedInRoom,
  resetChatAttachmentStoreForTests,
  shareFileInRoom
} from './chatAttachmentStore';

const tinyBase64 = Buffer.from('hello world').toString('base64');

describe('chatAttachmentStore', () => {
  beforeEach(() => {
    resetChatAttachmentStoreForTests();
  });

  it('shareFileInRoom stores a file and returns it with an id', () => {
    const file = shareFileInRoom({
      roomId: 'r1',
      filename: 'notes.txt',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    expect(file.id.startsWith('file_')).toBe(true);
    expect(file.filename).toBe('notes.txt');
    expect(file.byteSize).toBeGreaterThan(0);
    expect(file.uploadedByHandle).toBe('@you');
  });

  it('listFilesSharedInRoom returns the newest file first', () => {
    const first = shareFileInRoom({
      roomId: 'r1',
      filename: 'first.txt',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    const second = shareFileInRoom({
      roomId: 'r1',
      filename: 'second.txt',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    const list = listFilesSharedInRoom('r1');
    expect(list.map((file) => file.id)).toEqual([second.id, first.id]);
  });

  it('listFilesSharedInRoom returns an empty array for an unknown room', () => {
    expect(listFilesSharedInRoom('does_not_exist')).toEqual([]);
  });

  it('findSharedFileById returns the right file', () => {
    const file = shareFileInRoom({
      roomId: 'r1',
      filename: 'a.txt',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    expect(findSharedFileById(file.id)?.id).toBe(file.id);
  });

  it('keeps uploaded files available after the store module reloads', async () => {
    const file = shareFileInRoom({
      roomId: 'r1',
      filename: 'after-restart.png',
      mimeType: 'image/png',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });

    vi.resetModules();
    const reloadedStore = await import('./chatAttachmentStore');

    expect(reloadedStore.findSharedFileById(file.id)?.contentsBase64).toBe(tinyBase64);
    expect(reloadedStore.listFilesSharedInRoom('r1').map((entry) => entry.id)).toEqual([
      file.id
    ]);
  });

  it('findSharedFileById returns undefined for an unknown id', () => {
    expect(findSharedFileById('not_real')).toBeUndefined();
  });

  it('rejects a blank roomId', () => {
    expect(() =>
      shareFileInRoom({
        roomId: '   ',
        filename: 'a.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@you'
      })
    ).toThrow();
  });

  it('rejects a blank filename', () => {
    expect(() =>
      shareFileInRoom({
        roomId: 'r1',
        filename: '   ',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@you'
      })
    ).toThrow();
  });

  it('rejects a blank mimeType', () => {
    expect(() =>
      shareFileInRoom({
        roomId: 'r1',
        filename: 'a.txt',
        mimeType: '   ',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@you'
      })
    ).toThrow();
  });

  it('rejects a blank uploadedByHandle', () => {
    expect(() =>
      shareFileInRoom({
        roomId: 'r1',
        filename: 'a.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '   '
      })
    ).toThrow();
  });

  it('rejects empty contents', () => {
    expect(() =>
      shareFileInRoom({
        roomId: 'r1',
        filename: 'a.txt',
        mimeType: 'text/plain',
        contentsBase64: '',
        uploadedByHandle: '@you'
      })
    ).toThrow();
  });

  it('stores files above the old slice-1 cap when they are under 40 MB', () => {
    const sevenMegBase64 = Buffer.alloc(7 * 1024 * 1024).toString('base64');
    const file = shareFileInRoom({
      roomId: 'r1',
      filename: 'seven-meg.bin',
      mimeType: 'application/octet-stream',
      contentsBase64: sevenMegBase64,
      uploadedByHandle: '@you'
    });

    expect(file.byteSize).toBe(7 * 1024 * 1024);
  });

  it('rejects files larger than 40 MB', () => {
    const bigBase64 = Buffer.alloc((40 * 1024 * 1024) + 1).toString('base64');
    expect(() =>
      shareFileInRoom({
        roomId: 'r1',
        filename: 'big.bin',
        mimeType: 'application/octet-stream',
        contentsBase64: bigBase64,
        uploadedByHandle: '@you'
      })
    ).toThrow('max 40 MB');
  });

  it('strips path traversal segments from the filename', () => {
    const file = shareFileInRoom({
      roomId: 'r1',
      filename: '../../etc/passwd',
      mimeType: 'application/octet-stream',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    expect(file.filename).toBe('passwd');
  });

  it('strips a windows-style path prefix from the filename', () => {
    const file = shareFileInRoom({
      roomId: 'r1',
      filename: 'C:\\users\\you\\notes.txt',
      mimeType: 'application/octet-stream',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    expect(file.filename).toBe('notes.txt');
  });

  it('strips a leading dot so dotfiles become readable', () => {
    const file = shareFileInRoom({
      roomId: 'r1',
      filename: '.env',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    expect(file.filename).toBe('env');
  });

  it('estimates byteSize from base64 length minus padding', () => {
    const knownBytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const knownBase64 = knownBytes.toString('base64');
    const file = shareFileInRoom({
      roomId: 'r1',
      filename: 'bin',
      mimeType: 'application/octet-stream',
      contentsBase64: knownBase64,
      uploadedByHandle: '@you'
    });
    expect(file.byteSize).toBe(10);
  });

  it('rejects contentsBase64 that contains characters outside the base64 alphabet', () => {
    expect(() =>
      shareFileInRoom({
        roomId: 'r1',
        filename: 'bad.bin',
        mimeType: 'application/octet-stream',
        contentsBase64: '!!!!',
        uploadedByHandle: '@you'
      })
    ).toThrow();
  });

  it('rejects contentsBase64 whose length is not a multiple of 4', () => {
    for (const malformed of ['A', 'AB', 'ABC', 'ABCDE']) {
      expect(() =>
        shareFileInRoom({
          roomId: 'r1',
          filename: 'bad.bin',
          mimeType: 'application/octet-stream',
          contentsBase64: malformed,
          uploadedByHandle: '@you'
        })
      ).toThrow();
    }
  });

  it('rejects contentsBase64 whose padding sits in the middle of the string', () => {
    expect(() =>
      shareFileInRoom({
        roomId: 'r1',
        filename: 'bad.bin',
        mimeType: 'application/octet-stream',
        contentsBase64: 'AA==BBBB',
        uploadedByHandle: '@you'
      })
    ).toThrow();
  });

  it('accepts canonical base64 with zero, one, or two padding chars', () => {
    const oneByte = Buffer.from([1]).toString('base64'); // "AQ=="
    const twoBytes = Buffer.from([1, 2]).toString('base64'); // "AQI="
    const threeBytes = Buffer.from([1, 2, 3]).toString('base64'); // "AQID"
    expect([twoBytes.endsWith('='), oneByte.endsWith('==')]).toEqual([true, true]);
    for (const valid of [oneByte, twoBytes, threeBytes]) {
      const file = shareFileInRoom({
        roomId: 'r1',
        filename: 'ok.bin',
        mimeType: 'application/octet-stream',
        contentsBase64: valid,
        uploadedByHandle: '@you'
      });
      expect(file.byteSize).toBeGreaterThan(0);
    }
  });

  it('keeps files per-room independent', () => {
    shareFileInRoom({
      roomId: 'r1',
      filename: 'a.txt',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    shareFileInRoom({
      roomId: 'r2',
      filename: 'b.txt',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    expect(listFilesSharedInRoom('r1')).toHaveLength(1);
    expect(listFilesSharedInRoom('r2')).toHaveLength(1);
  });
});
