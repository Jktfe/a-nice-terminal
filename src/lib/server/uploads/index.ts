import { createHash } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';

const DEFAULT_MAX_FILE_SIZE_MB = 100;
const DEFAULT_RATE_LIMIT_PER_HANDLE = 1000;
const DEFAULT_DAILY_BYTES_PER_HANDLE = 100 * 1024 * 1024 * 1024;
const DEFAULT_MIME_ALLOWLIST = [
  'image/*',
  'text/*',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/typescript': 'ts',
  'text/javascript': 'js',
  'text/csv': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

export interface UploadPolicySettings {
  maxFileSizeMb?: string | number | null;
  rateLimitPerHandle?: string | number | null;
  dailyBytesPerHandle?: string | number | null;
  mimeAllowlist?: string | string[] | null;
}

export interface UploadPolicy {
  maxFileSizeMb: number;
  maxFileSizeBytes: number;
  rateLimitPerHandle: number | null;
  dailyBytesPerHandle: number | null;
  mimeAllowlist: string[];
}

export interface UploadIdentity {
  sessionId: string;
  handle: string;
  displayName: string | null;
  source: 'referer' | 'query' | 'room-scope';
}

export type UploadIdentityResult =
  | { ok: true; identity: UploadIdentity }
  | { ok: false; status: 401 | 403; message: string };

type SessionRow = {
  id: string;
  handle?: string | null;
  display_name?: string | null;
  name?: string | null;
  archived?: number | boolean | null;
  deleted_at?: string | null;
};

interface IdentityQueries {
  getSession(id: string): SessionRow | undefined;
  getSessionByHandle(handle: string): SessionRow | undefined;
}

function firstPolicyValue(
  settingValue: string | number | string[] | null | undefined,
  envName: string,
): string | number | string[] | null | undefined {
  return settingValue ?? process.env[envName];
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalLimit(value: unknown, fallback: number): number | null {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['', 'default'].includes(normalized)) return fallback;
    if (['unlimited', 'infinite', 'inf', 'none'].includes(normalized)) return null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseMimeAllowlist(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : DEFAULT_MIME_ALLOWLIST;
  const clean = raw
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);
  return clean.length > 0 ? clean : DEFAULT_MIME_ALLOWLIST;
}

export function getUploadPolicy(settings: UploadPolicySettings = {}): UploadPolicy {
  const maxFileSizeMb = parsePositiveNumber(
    firstPolicyValue(settings.maxFileSizeMb, 'MAX_FILE_SIZE_MB'),
    DEFAULT_MAX_FILE_SIZE_MB,
  );
  const rateLimitPerHandle = parseOptionalLimit(
    firstPolicyValue(settings.rateLimitPerHandle, 'UPLOAD_RATE_LIMIT_PER_HANDLE'),
    DEFAULT_RATE_LIMIT_PER_HANDLE,
  );
  const dailyBytesPerHandle = parseOptionalLimit(
    firstPolicyValue(settings.dailyBytesPerHandle, 'UPLOAD_DAILY_BYTES_PER_HANDLE'),
    DEFAULT_DAILY_BYTES_PER_HANDLE,
  );
  const mimeAllowlist = parseMimeAllowlist(firstPolicyValue(settings.mimeAllowlist, 'UPLOAD_MIME_ALLOWLIST'));

  return {
    maxFileSizeMb,
    maxFileSizeBytes: Math.floor(maxFileSizeMb * 1024 * 1024),
    rateLimitPerHandle,
    dailyBytesPerHandle,
    mimeAllowlist,
  };
}

export function uploadBodyMaxSize(): string {
  const policy = getUploadPolicy();
  return `${Math.max(1, Math.ceil(policy.maxFileSizeMb + 1))}m`;
}

export function isMimeAllowed(mimeType: string, allowlist: string[]): boolean {
  const normalized = mimeType.trim().toLowerCase();
  if (!normalized) return false;
  return allowlist.some((entry) => {
    if (entry === '*/*' || entry === '*') return true;
    if (entry.endsWith('/*')) return normalized.startsWith(entry.slice(0, -1));
    return normalized === entry;
  });
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function contentAddressedFilename(hash: string, mimeType: string, originalName?: string | null): string {
  return `${hash}.${extensionForFile(mimeType, originalName)}`;
}

function extensionForFile(mimeType: string, originalName?: string | null): string {
  const normalizedMime = mimeType.trim().toLowerCase();
  const known = MIME_EXTENSION[normalizedMime];
  if (known) return known;

  const subtype = normalizedMime.split('/')[1]?.replace(/\+xml$/, '') ?? '';
  const fromMime = subtype.replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (fromMime) return fromMime;

  const match = originalName?.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match?.[1] ?? 'bin';
}

function normalizeHandle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function authKeyMatches(event: RequestEvent): boolean {
  const apiKey = process.env.ANT_API_KEY;
  if (!apiKey) return false;
  const auth = event.request.headers.get('authorization') || '';
  const provided = auth.startsWith('Bearer ')
    ? auth.slice('Bearer '.length)
    : event.request.headers.get('x-api-key') || event.url.searchParams.get('apiKey') || '';
  return provided === apiKey;
}

function isSameOrigin(event: RequestEvent): boolean {
  const origin = event.request.headers.get('origin');
  if (origin) return origin === event.url.origin;

  const referer = event.request.headers.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).origin === event.url.origin;
  } catch {
    return false;
  }
}

function sessionIdFromReferer(event: RequestEvent): string | null {
  const referer = event.request.headers.get('referer');
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.origin !== event.url.origin) return null;
    const match = url.pathname.match(/^\/session\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function activeSession(row: SessionRow | undefined): SessionRow | null {
  if (!row) return null;
  if (row.deleted_at || row.archived) return null;
  return row;
}

function identityFromSession(row: SessionRow, source: UploadIdentity['source']): UploadIdentity {
  return {
    sessionId: row.id,
    handle: row.handle || row.id,
    displayName: row.display_name || row.name || null,
    source,
  };
}

export function resolveUploadIdentity(event: RequestEvent, queries: IdentityQueries): UploadIdentityResult {
  const scoped = (event.locals as Record<string, unknown>).roomScope as { roomId?: unknown } | undefined;
  const isScoped = typeof scoped?.roomId === 'string';
  if (!isScoped && !isSameOrigin(event) && !authKeyMatches(event)) {
    return { ok: false, status: 401, message: 'Upload requires an authenticated ANT session or handle' };
  }

  const sessionParam = event.url.searchParams.get('session_id') || event.url.searchParams.get('sessionId');
  const handleParam = event.url.searchParams.get('handle');
  const sessionId = (isScoped ? String(scoped.roomId) : sessionParam || sessionIdFromReferer(event))?.trim() || null;
  const handle = handleParam ? normalizeHandle(handleParam) : null;

  if (sessionId) {
    const row = activeSession(queries.getSession(sessionId));
    if (!row) return { ok: false, status: 401, message: 'Upload session identity was not found' };
    if (handle && row.handle && normalizeHandle(row.handle) !== handle) {
      return { ok: false, status: 403, message: 'Upload handle does not match the session identity' };
    }
    return { ok: true, identity: identityFromSession(row, isScoped ? 'room-scope' : sessionParam ? 'query' : 'referer') };
  }

  if (handle) {
    const row = activeSession(queries.getSessionByHandle(handle));
    if (!row) return { ok: false, status: 401, message: 'Upload handle identity was not found' };
    return { ok: true, identity: identityFromSession(row, 'query') };
  }

  return { ok: false, status: 401, message: 'Upload requires an ANT session_id or registered handle' };
}
