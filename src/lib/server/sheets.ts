import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { queries } from './db.js';
import {
  ALLOWED_HIDDEN_FILES,
  BLOCKED_SEGMENTS,
  assertInside,
  assertNoSymlinkSegments,
  assertSafeSheetSlug,
} from './artefact-fs.js';
import { broadcast } from './ws-broadcast.js';

// Sheets reuse the Open-Slide root that decks already live under. Sheet code
// is a structural copy of decks.ts: same concurrency contract (whole-file
// base_hash + if_match_mtime), same audit JSONL + run_event projection. Cell
// aware diffs are a future follow-up.
const DEFAULT_OPEN_SLIDE_DIR = join(homedir(), 'CascadeProjects', 'ANT-Open-Slide');
const INTERNAL_SEGMENTS = new Set(['.ant-sheet']);
const MANIFEST_FILENAME = '.ant-sheet.json';
const AUDIT_REL_PATH = '.ant-sheet/audit.jsonl';
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export { assertSafeSheetSlug };

export interface SheetMeta {
  slug: string;
  title: string;
  sheet_dir: string;
  owner_session_id: string;
  allowed_room_ids: string[];
  dev_port: number | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface SheetFileEntry {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  mtime_ms: number;
}

export interface SheetFileSnapshot {
  path: string;
  size: number;
  mtime_ms: number;
  sha256: string;
}

export interface SheetManifest {
  schema_version: 1;
  kind: 'ant-open-slide-sheet';
  slug: string;
  title: string;
  sheet_dir: string;
  owner_session_id: string;
  allowed_room_ids: string[];
  dev_port: number | null;
  source_session_id: string | null;
  source_evidence_hash: string | null;
  generator: {
    name: string;
    version: string;
  };
  generated_at: string;
  updated_at: string;
  files: SheetFileSnapshot[];
}

export interface SheetManifestInput {
  source_session_id?: string | null;
  source_evidence_hash?: string | null;
  generator?: {
    name: string;
    version: string;
  };
}

export interface SheetAuditEvent {
  ts: string;
  sheet_slug: string;
  type: string;
  actor: string;
  path?: string | null;
  details?: Record<string, unknown>;
}

export interface SheetWriteGuard {
  base_hash?: string | null;
  if_match_mtime?: number | null;
  actor?: string | null;
}

export interface SheetWriteResult {
  path: string;
  size: number;
  mtime_ms: number;
  sha256: string;
  manifest: SheetManifest;
}

export class SheetConflictError extends Error {
  code = 'SHEET_CONFLICT';
  status = 409;
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'SheetConflictError';
    this.details = details;
  }
}

export interface RegisterSheetInput {
  slug: string;
  owner_session_id?: string;
  allowed_room_ids?: string[];
  sheet_dir?: string | null;
  dev_port?: number | null;
}

export function openSlideRoot(): string {
  return process.env.ANT_OPEN_SLIDE_DIR || DEFAULT_OPEN_SLIDE_DIR;
}

export function sheetMaxFileBytes(): number {
  const raw = Number(process.env.ANT_SHEET_MAX_FILE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_FILE_BYTES;
}

function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function sha256Bytes(bytes: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function defaultSheetDirForSlug(slug: string): string {
  const safe = assertSafeSheetSlug(slug);
  const root = resolve(openSlideRoot());
  const sheetDir = resolve(root, safe);
  assertInside(root, sheetDir);
  return sheetDir;
}

function normaliseSheetDir(input: string | null | undefined, slug: string): string {
  const root = resolve(openSlideRoot());
  const sheetDir = resolve(input || defaultSheetDirForSlug(slug));
  assertInside(root, sheetDir);
  return sheetDir;
}

export function parseRoomIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return parseRoomIds(parsed);
  } catch {
    return [];
  }
}

function manifestPath(sheet: SheetMeta): string {
  return join(sheet.sheet_dir, MANIFEST_FILENAME);
}

function auditPath(sheet: SheetMeta): string {
  return join(sheet.sheet_dir, AUDIT_REL_PATH);
}

function roomSet(ownerSessionId: string, roomIds: string[] | undefined): string[] {
  const rooms = new Set<string>();
  rooms.add(ownerSessionId);
  for (const id of roomIds ?? []) {
    if (typeof id === 'string' && id.trim()) rooms.add(id.trim());
  }
  return Array.from(rooms);
}

function rowToSheet(row: any): SheetMeta {
  const slug = String(row.slug);
  const ownerSessionId = typeof row.owner_session_id === 'string' ? row.owner_session_id : '';
  return {
    slug,
    title: titleFromSlug(slug),
    sheet_dir: String(row.sheet_dir),
    owner_session_id: ownerSessionId,
    allowed_room_ids: roomSet(ownerSessionId, parseRoomIds(row.allowed_room_ids)),
    dev_port: typeof row.dev_port === 'number' ? row.dev_port : row.dev_port == null ? null : Number(row.dev_port),
    created_at: typeof row.created_at === 'number' ? row.created_at : Number(row.created_at) || null,
    updated_at: typeof row.updated_at === 'number' ? row.updated_at : Number(row.updated_at) || null,
  };
}

export function readSheetMeta(slug: string): SheetMeta | null {
  const safe = assertSafeSheetSlug(slug);
  const row = queries.getSheet(safe);
  if (!row) return null;
  return rowToSheet(row);
}

export function registerSheet(input: RegisterSheetInput): SheetMeta {
  const slug = assertSafeSheetSlug(input.slug);
  const previous = readSheetMeta(slug);
  const ownerSessionId = input.owner_session_id ?? previous?.owner_session_id;
  if (!ownerSessionId) throw new Error('Sheet owner_session_id required');
  const allowedRoomIds = roomSet(ownerSessionId, input.allowed_room_ids ?? previous?.allowed_room_ids ?? []);
  const sheetDir = normaliseSheetDir(input.sheet_dir ?? previous?.sheet_dir, slug);
  mkdirSync(sheetDir, { recursive: true });

  queries.upsertSheet({
    slug,
    owner_session_id: ownerSessionId,
    allowed_room_ids: JSON.stringify(allowedRoomIds),
    sheet_dir: sheetDir,
    dev_port: input.dev_port ?? previous?.dev_port ?? null,
    now_ms: Date.now(),
  });

  const sheet = readSheetMeta(slug);
  if (!sheet) throw new Error('Failed to register sheet');
  return sheet;
}

export function listSheets(): SheetMeta[] {
  return (queries.listSheets() as any[]).map(rowToSheet);
}

// Sheet-flavoured cleaner: artefact-fs provides the generic version, but
// sheets layer on the manifest + .ant-sheet/ rejection so file API callers
// can't reach into internal metadata.
function cleanSheetPath(path: string): string {
  const raw = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (raw.includes('\0') || /[\x00-\x1F\x7F]/.test(raw)) {
    throw new Error('Sheet path contains invalid bytes');
  }
  if (raw.includes('../') || raw === '..' || raw.startsWith('..')) {
    throw new Error('Path traversal is not allowed');
  }
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error('Path traversal is not allowed');
    if (BLOCKED_SEGMENTS.has(part)) throw new Error(`Sheet path segment "${part}" is not editable`);
    if (INTERNAL_SEGMENTS.has(part) || part === MANIFEST_FILENAME) {
      throw new Error('Sheet internal metadata is not editable through the file API');
    }
    parts.push(part);
  }
  return parts.join('/');
}

export function resolveSheetFile(sheet: SheetMeta, path: string): { relPath: string; absPath: string } {
  const relPath = cleanSheetPath(path);
  if (!relPath) throw new Error('Sheet file path required');
  const absPath = resolve(sheet.sheet_dir, relPath);
  assertInside(sheet.sheet_dir, absPath);
  assertNoSymlinkSegments(sheet.sheet_dir, relPath);
  return { relPath, absPath };
}

export function listSheetFiles(sheet: SheetMeta): SheetFileEntry[] {
  if (!existsSync(sheet.sheet_dir)) throw new Error('Sheet not found');
  const rows: SheetFileEntry[] = [];

  function walk(dir: string, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (BLOCKED_SEGMENTS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && !ALLOWED_HIDDEN_FILES.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = statSync(abs);
      if (entry.isDirectory()) {
        rows.push({ path: rel, kind: 'dir', size: 0, mtime_ms: stat.mtimeMs });
        walk(abs, rel);
      } else if (entry.isFile()) {
        rows.push({ path: rel, kind: 'file', size: stat.size, mtime_ms: stat.mtimeMs });
      }
    }
  }

  walk(sheet.sheet_dir);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function readSheetTextFile(sheet: SheetMeta, path: string): { path: string; content: string; size: number; updated_at: string } {
  const resolved = resolveSheetFile(sheet, path);
  const stat = statSync(resolved.absPath);
  if (!stat.isFile()) throw new Error('Sheet path is not a file');
  if (stat.size > sheetMaxFileBytes()) throw new Error('Sheet file exceeds max size');
  return {
    path: resolved.relPath,
    content: readFileSync(resolved.absPath, 'utf8'),
    size: stat.size,
    updated_at: stat.mtime.toISOString(),
  };
}

export function readSheetBytes(sheet: SheetMeta, path: string): { path: string; bytes: Buffer; size: number; mtime_ms: number; sha256: string } {
  const resolved = resolveSheetFile(sheet, path);
  const stat = statSync(resolved.absPath);
  if (!stat.isFile()) throw new Error('Sheet path is not a file');
  if (stat.size > sheetMaxFileBytes()) throw new Error('Sheet file exceeds max size');
  const bytes = readFileSync(resolved.absPath);
  return {
    path: resolved.relPath,
    bytes,
    size: stat.size,
    mtime_ms: stat.mtimeMs,
    sha256: sha256Bytes(bytes),
  };
}

function currentFileFingerprint(absPath: string): { exists: boolean; sha256: string | null; mtime_ms: number | null } {
  if (!existsSync(absPath)) return { exists: false, sha256: null, mtime_ms: null };
  const stat = statSync(absPath);
  if (!stat.isFile()) throw new Error('Sheet path is not a file');
  const bytes = readFileSync(absPath);
  return {
    exists: true,
    sha256: sha256Bytes(bytes),
    mtime_ms: stat.mtimeMs,
  };
}

function assertWriteGuard(sheet: SheetMeta, path: string, absPath: string, guard: SheetWriteGuard | undefined): void {
  const baseHash = typeof guard?.base_hash === 'string' && guard.base_hash.trim()
    ? guard.base_hash.trim().toLowerCase()
    : null;
  const ifMatchMtime = typeof guard?.if_match_mtime === 'number' && Number.isFinite(guard.if_match_mtime)
    ? guard.if_match_mtime
    : null;
  if (!baseHash && ifMatchMtime === null) return;

  const current = currentFileFingerprint(absPath);
  const details = {
    path,
    expected_base_hash: baseHash,
    actual_hash: current.sha256,
    expected_mtime_ms: ifMatchMtime,
    actual_mtime_ms: current.mtime_ms,
    exists: current.exists,
  };
  const hashMismatch = baseHash !== null && current.sha256 !== baseHash;
  const mtimeMismatch = ifMatchMtime !== null && (
    current.mtime_ms === null || Math.abs(current.mtime_ms - ifMatchMtime) > 1
  );
  if (!hashMismatch && !mtimeMismatch) return;

  recordSheetAudit(sheet, {
    type: 'conflict',
    actor: guard?.actor || 'unknown',
    path,
    details,
  });
  throw new SheetConflictError('Sheet file changed since caller base; refusing to overwrite', details);
}

export function writeSheetBytes(
  sheet: SheetMeta,
  path: string,
  bytes: Buffer | Uint8Array,
  options: SheetWriteGuard = {},
): SheetWriteResult {
  if (bytes.byteLength > sheetMaxFileBytes()) throw new Error('Sheet file exceeds max size');
  const resolved = resolveSheetFile(sheet, path);
  assertWriteGuard(sheet, resolved.relPath, resolved.absPath, options);
  mkdirSync(dirname(resolved.absPath), { recursive: true });
  writeFileSync(resolved.absPath, bytes);
  const stat = statSync(resolved.absPath);
  const sha256 = sha256Bytes(bytes);
  const manifest = writeSheetManifest(sheet);
  recordSheetAudit(sheet, {
    type: 'file_write',
    actor: options.actor || 'unknown',
    path: resolved.relPath,
    details: { size: stat.size, mtime_ms: stat.mtimeMs, sha256 },
  });
  return { path: resolved.relPath, size: stat.size, mtime_ms: stat.mtimeMs, sha256, manifest };
}

export function writeSheetTextFile(sheet: SheetMeta, path: string, content: string): { path: string; size: number; updated_at: string } {
  const resolved = resolveSheetFile(sheet, path);
  mkdirSync(dirname(resolved.absPath), { recursive: true });
  writeFileSync(resolved.absPath, content, 'utf8');
  const stat = statSync(resolved.absPath);
  return { path: resolved.relPath, size: stat.size, updated_at: stat.mtime.toISOString() };
}

export function deleteSheetPath(sheet: SheetMeta, path: string, options: SheetWriteGuard = {}): { path: string; manifest: SheetManifest } {
  const resolved = resolveSheetFile(sheet, path);
  assertWriteGuard(sheet, resolved.relPath, resolved.absPath, options);
  const stat = statSync(resolved.absPath);
  if (stat.isDirectory()) throw new Error('Deleting directories is not supported');
  rmSync(resolved.absPath, { recursive: true, force: true });
  const manifest = writeSheetManifest(sheet);
  recordSheetAudit(sheet, {
    type: 'file_delete',
    actor: options.actor || 'unknown',
    path: resolved.relPath,
  });
  return { path: resolved.relPath, manifest };
}

export function readSheetManifest(sheet: SheetMeta): SheetManifest | null {
  const path = manifestPath(sheet);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'ant-open-slide-sheet') return null;
    return parsed as SheetManifest;
  } catch {
    return null;
  }
}

export function sheetFileSnapshots(sheet: SheetMeta): SheetFileSnapshot[] {
  const snapshots: SheetFileSnapshot[] = [];
  for (const entry of listSheetFiles(sheet)) {
    if (entry.kind !== 'file') continue;
    const resolved = resolveSheetFile(sheet, entry.path);
    try {
      const bytes = readFileSync(resolved.absPath);
      const stat = statSync(resolved.absPath);
      if (!stat.isFile()) continue;
      snapshots.push({
        path: entry.path,
        size: stat.size,
        mtime_ms: stat.mtimeMs,
        sha256: sha256Bytes(bytes),
      });
    } catch {
      // A concurrent editor may have moved the file between list and hash.
      // The next status call will rebuild a complete snapshot.
    }
  }
  return snapshots.sort((a, b) => a.path.localeCompare(b.path));
}

export function writeSheetManifest(sheet: SheetMeta, input: SheetManifestInput = {}): SheetManifest {
  const previous = readSheetManifest(sheet);
  const now = new Date().toISOString();
  const manifest: SheetManifest = {
    schema_version: 1,
    kind: 'ant-open-slide-sheet',
    slug: sheet.slug,
    title: sheet.title,
    sheet_dir: sheet.sheet_dir,
    owner_session_id: sheet.owner_session_id,
    allowed_room_ids: sheet.allowed_room_ids,
    dev_port: sheet.dev_port,
    source_session_id: input.source_session_id ?? previous?.source_session_id ?? sheet.owner_session_id ?? null,
    source_evidence_hash: input.source_evidence_hash ?? previous?.source_evidence_hash ?? null,
    generator: input.generator ?? previous?.generator ?? { name: 'ant-open-slide', version: '1' },
    generated_at: previous?.generated_at ?? now,
    updated_at: now,
    files: sheetFileSnapshots(sheet),
  };
  writeFileSync(manifestPath(sheet), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

export function recordSheetAudit(sheet: SheetMeta, event: Omit<SheetAuditEvent, 'ts' | 'sheet_slug'> & { ts?: string }): SheetAuditEvent {
  const row: SheetAuditEvent = {
    ts: event.ts ?? new Date().toISOString(),
    sheet_slug: sheet.slug,
    type: event.type,
    actor: event.actor,
    path: event.path ?? null,
    details: event.details ?? {},
  };
  const path = auditPath(sheet);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + '\n', 'utf8');
  appendSheetAuditRunEvent(sheet, row);
  return row;
}

function appendSheetAuditRunEvent(sheet: SheetMeta, row: SheetAuditEvent): void {
  if (!sheet.owner_session_id) return;
  const tsMs = Date.parse(row.ts);
  const details = row.details ?? {};
  const kind = row.type === 'conflict' ? 'artifact_conflict' : 'artifact_write';
  const text = row.path
    ? `${row.type} ${sheet.slug}/${row.path}`
    : `${row.type} ${sheet.slug}`;
  const payload = {
    sheet_slug: sheet.slug,
    sheet_dir: sheet.sheet_dir,
    audit_type: row.type,
    actor: row.actor,
    path: row.path ?? null,
    details,
    base_hash: typeof details.expected_base_hash === 'string'
      ? details.expected_base_hash
      : typeof details.base_hash === 'string'
        ? details.base_hash
        : null,
    sha256: typeof details.sha256 === 'string' ? details.sha256 : null,
    manifest_path: manifestPath(sheet),
    audit_path: auditPath(sheet),
  };
  try {
    const eventRow = queries.appendRunEvent(
      sheet.owner_session_id,
      Number.isFinite(tsMs) ? tsMs : Date.now(),
      'json',
      'high',
      kind,
      text,
      JSON.stringify(payload),
      `sheet_audit:${sheet.slug}:${row.ts}:${row.type}:${row.path ?? ''}`,
    ) as any;
    broadcast(sheet.owner_session_id, {
      type: 'run_event_created',
      sessionId: sheet.owner_session_id,
      event: {
        id: eventRow.id,
        session_id: eventRow.session_id,
        ts: eventRow.ts_ms,
        ts_ms: eventRow.ts_ms,
        source: eventRow.source,
        trust: eventRow.trust,
        kind: eventRow.kind,
        text: eventRow.text ?? '',
        payload,
        raw_ref: eventRow.raw_ref ?? null,
        created_at: eventRow.created_at,
      },
    });
  } catch {
    // Audit JSONL is the primary write path; run_events are a best-effort
    // evidence projection and must not break sheet writes.
  }
}

export function readSheetAudit(sheet: SheetMeta, limit = 100): SheetAuditEvent[] {
  const path = auditPath(sheet);
  if (!existsSync(path)) return [];
  const max = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 100;
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-max)
    .map((line) => {
      try {
        return JSON.parse(line) as SheetAuditEvent;
      } catch {
        return null;
      }
    })
    .filter((row): row is SheetAuditEvent => Boolean(row));
}
