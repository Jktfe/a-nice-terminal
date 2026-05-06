import { error } from '@sveltejs/kit';
import { readFile, stat } from 'fs/promises';
import { extname, relative, resolve } from 'path';

const ALLOWED_TOP_LEVEL = new Set(['docs', 'output']);
const MAX_BYTES = 1024 * 1024;

function cleanPath(raw: string | null): string {
  const value = String(raw ?? '').trim();
  if (!value || value.includes('\0')) throw error(400, 'path required');

  const root = resolve(process.cwd());
  const target = resolve(root, value);
  const rel = relative(root, target).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || rel.startsWith('/')) throw error(403, 'path outside workspace');
  if (!ALLOWED_TOP_LEVEL.has(rel.split('/')[0])) throw error(403, 'workspace path not allowed');
  return target;
}

function contentType(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.txt' || ext === '.log') return 'text/plain; charset=utf-8';
  if (ext === '.json' || ext === '.jsonl') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

export async function GET({ url }: { url: URL }) {
  const path = cleanPath(url.searchParams.get('path'));
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) throw error(404, 'file not found');
  if (info.size > MAX_BYTES) throw error(413, 'file too large');
  const bytes = await readFile(path);
  return new Response(bytes, {
    headers: {
      'Content-Type': contentType(path),
      'Cache-Control': 'no-store',
      'Content-Length': String(bytes.byteLength),
    },
  });
}
