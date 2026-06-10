// POST /api/manual/screenshots — slice 2 (JWPK 2026-05-23) screenshot
// upload. multipart/form-data with fields: screenId, stateSlug, file.
// File is written to static/manual/<screenId>-<stateSlug>.<ext> so the
// browser can fetch it via the same /manual/... path used by the seeded
// images. Returns the public path + measured dimensions.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB ceiling

function sanitiseSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function extensionFromName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

// PNG signature: 89 50 4E 47 0D 0A 1A 0A then IHDR chunk at offset 8.
// IHDR length=13 (4 bytes), "IHDR" (4), width (4 BE), height (4 BE).
function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

export const POST: RequestHandler = async ({ request }) => {
  const formData = await request.formData().catch(() => null);
  if (!formData) throw error(400, 'multipart/form-data required');

  const screenIdRaw = formData.get('screenId');
  const stateSlugRaw = formData.get('stateSlug');
  const fileEntry = formData.get('file');

  if (typeof screenIdRaw !== 'string' || screenIdRaw.length === 0) throw error(400, 'screenId required');
  if (typeof stateSlugRaw !== 'string' || stateSlugRaw.length === 0) throw error(400, 'stateSlug required');
  if (!(fileEntry instanceof File)) throw error(400, 'file required');

  const screenId = sanitiseSegment(screenIdRaw);
  const stateSlug = sanitiseSegment(stateSlugRaw);
  if (screenId.length === 0 || stateSlug.length === 0) throw error(400, 'screenId/stateSlug must be alphanumeric');

  if (fileEntry.size > MAX_BYTES) throw error(413, `file exceeds ${MAX_BYTES} bytes`);
  const ext = extensionFromName(fileEntry.name) ?? 'png';

  const buffer = Buffer.from(await fileEntry.arrayBuffer());
  // Best-effort dimensions read (PNG only for now; other formats fall
  // back to default 2560x1600 if reader doesn't recognise the header).
  const dims = readPngDimensions(buffer);

  const dirAbs = join(process.cwd(), 'static', 'manual', 'uploads');
  await mkdir(dirAbs, { recursive: true });
  const filename = `${screenId}-${stateSlug}.${ext}`;
  const fileAbs = join(dirAbs, filename);
  await writeFile(fileAbs, buffer);

  // Public URL path served by SvelteKit's static handler.
  const publicPath = `/manual/uploads/${filename}`;
  return json({
    path: publicPath,
    width: dims?.width ?? 2560,
    height: dims?.height ?? 1600,
    sizeBytes: buffer.length
  }, { status: 201 });
};
