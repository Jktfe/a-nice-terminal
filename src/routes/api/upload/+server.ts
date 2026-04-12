import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { nanoid } from 'nanoid';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const UPLOAD_DIR = join(process.cwd(), 'static', 'uploads');

export async function POST({ request }: RequestEvent) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    throw error(400, 'Expected multipart/form-data');
  }

  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof File)) {
    throw error(400, 'Missing "file" field');
  }

  if (!file.type.startsWith('image/')) {
    throw error(400, 'Only image/* mime types are accepted');
  }

  if (file.size > MAX_FILE_SIZE) {
    throw error(413, 'File exceeds 10 MB limit');
  }

  // Derive extension from mime type
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
  const filename = `${Date.now()}-${nanoid(8)}.${ext}`;

  await mkdir(UPLOAD_DIR, { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(UPLOAD_DIR, filename), buffer);

  return json({ url: `/uploads/${filename}` });
}
