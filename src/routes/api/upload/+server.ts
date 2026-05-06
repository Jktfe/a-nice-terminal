import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import {
  contentAddressedFilename,
  getUploadPolicy,
  isMimeAllowed,
  resolveUploadIdentity,
  sha256Hex,
  uploadBodyMaxSize,
} from '$lib/server/uploads';

export const config = { body: { maxSize: uploadBodyMaxSize() } };

// Resolve the upload directory at request time, not module-init time.
// SvelteKit endpoints are imported once per server boot and cached, so a
// constant captured at top-level would freeze process.cwd() for the rest of
// the process — which breaks per-test isolation in tests/upload-hardening,
// and also misses any chdir done by deployment scripts after boot.
const UPLOAD_URL_PREFIX = '/uploads';
function uploadDir(): string {
  return join(process.cwd(), 'static', 'uploads');
}

function uploadPolicyFromConfig() {
  return getUploadPolicy({
    maxFileSizeMb: queries.getSetting('uploads.max_file_size_mb'),
    rateLimitPerHandle: queries.getSetting('uploads.rate_limit_per_handle'),
    dailyBytesPerHandle: queries.getSetting('uploads.daily_bytes_per_handle'),
    mimeAllowlist: queries.getSetting('uploads.mime_allowlist'),
  });
}

function handleLimitExceeded(handle: string, fileSize: number, policy: ReturnType<typeof getUploadPolicy>): void {
  if (policy.rateLimitPerHandle !== null) {
    const uploadsThisHour = Number(queries.countUploadsForHandleSince(handle, 60 * 60));
    if (uploadsThisHour >= policy.rateLimitPerHandle) {
      throw error(429, 'Upload rate limit exceeded for this handle');
    }
  }

  if (policy.dailyBytesPerHandle !== null) {
    const bytesToday = Number(queries.sumUploadBytesForHandleSince(handle, 24 * 60 * 60));
    if (bytesToday + fileSize > policy.dailyBytesPerHandle) {
      throw error(429, 'Daily upload byte quota exceeded for this handle');
    }
  }
}

export async function POST(event: RequestEvent) {
  const identityResult = resolveUploadIdentity(event, queries);
  if (!identityResult.ok) {
    throw error(identityResult.status, identityResult.message);
  }
  const identity = identityResult.identity;

  const contentType = event.request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    throw error(400, 'Expected multipart/form-data');
  }

  const formData = await event.request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    throw error(400, 'Missing "file" field');
  }

  const policy = uploadPolicyFromConfig();
  const mimeType = file.type || 'application/octet-stream';
  if (!isMimeAllowed(mimeType, policy.mimeAllowlist)) {
    throw error(400, 'File MIME type is not allowed by upload policy');
  }

  if (file.size > policy.maxFileSizeBytes) {
    throw error(413, `File exceeds configured ${policy.maxFileSizeMb} MB limit`);
  }

  handleLimitExceeded(identity.handle, file.size, policy);

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = sha256Hex(buffer);
  const filename = contentAddressedFilename(contentHash, mimeType, file.name);
  const storagePath = join('static', 'uploads', filename);
  const publicUrl = `${UPLOAD_URL_PREFIX}/${filename}`;

  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, filename), buffer, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
  }

  queries.recordUpload(
    randomUUID(),
    identity.sessionId,
    identity.handle,
    file.name || null,
    mimeType,
    contentHash,
    buffer.length,
    storagePath,
    publicUrl,
  );

  return json({
    url: publicUrl,
    markdown: `![image](${publicUrl})`,
    session_id: identity.sessionId,
    handle: identity.handle,
    hash: contentHash,
    size: buffer.length,
  });
}
