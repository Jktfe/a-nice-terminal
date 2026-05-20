/**
 * screenshotCapture — M-SHARED-SCREENSHOTS T3c capture-wrapper module.
 *
 * Atomic flow per design contract Q3 (RQO B2 locked):
 *   1. Compute SHA-256 of bytes.
 *   2. Write to static/uploads/.tmp/<random>.png.
 *   3. checkDedupAndReserve transactionally checks enabled-flag, looks for
 *      existing (sha, room) row, INSERTs new row when absent.
 *   4a. kind=inserted → rename temp to static/uploads/rooms/<room>/screenshots/<sha>.png.
 *   4b. kind=existing → discard temp file (canonical path already in place).
 *   On error mid-flow, the temp file is always cleaned up.
 *
 * Storage roots are resolved off process.cwd() so vitest can drop them
 * under a temp dir via ANT_UPLOAD_ROOT env (defaults to process.cwd()/static).
 */
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  checkDedupAndReserve,
  type ReserveResult,
  type ScreenshotRow
} from './screenshotIndexStore';

export type CaptureInput = {
  roomId: string;
  takenBy: string;
  bytes: Buffer;
  topic?: string;
  dimensions?: string;
  parentSha?: string;
  deckSlug?: string;
};

export type CaptureResult = {
  kind: 'existing' | 'inserted';
  sha: string;
  canonicalPath: string;
  row: ScreenshotRow;
};

function uploadRoot(): string {
  return process.env.ANT_UPLOAD_ROOT ?? join(process.cwd(), 'static');
}

function tempDir(): string {
  return join(uploadRoot(), 'uploads', '.tmp');
}

function roomDir(roomId: string): string {
  return join(uploadRoot(), 'uploads', 'rooms', roomId, 'screenshots');
}

function canonicalPath(roomId: string, sha: string): string {
  return join(roomDir(roomId), `${sha}.png`);
}

export async function captureScreenshotToRoom(input: CaptureInput): Promise<CaptureResult> {
  if (input.bytes.length === 0) {
    throw new Error('captureScreenshotToRoom: bytes buffer is empty.');
  }

  const sha = createHash('sha256').update(input.bytes).digest('hex');

  await mkdir(tempDir(), { recursive: true });
  const tempPath = join(tempDir(), `${randomUUID()}.png`);
  await writeFile(tempPath, input.bytes);

  let reserveResult: ReserveResult;
  try {
    reserveResult = checkDedupAndReserve({
      roomId: input.roomId,
      sha,
      takenBy: input.takenBy,
      bytes: input.bytes.length,
      topic: input.topic,
      dimensions: input.dimensions,
      parentSha: input.parentSha,
      deckSlug: input.deckSlug
    });
  } catch (cause) {
    await unlink(tempPath).catch(() => {});
    throw cause;
  }

  const target = canonicalPath(input.roomId, sha);
  if (reserveResult.kind === 'existing') {
    await unlink(tempPath).catch(() => {});
    return { kind: 'existing', sha, canonicalPath: target, row: reserveResult.row };
  }

  await mkdir(roomDir(input.roomId), { recursive: true });
  await rename(tempPath, target);
  return { kind: 'inserted', sha, canonicalPath: target, row: reserveResult.row };
}
