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
  assertSafeDeckSlug,
} from './artefact-fs.js';
import { broadcast } from './ws-broadcast.js';

const DEFAULT_OPEN_SLIDE_DIR = join(homedir(), 'CascadeProjects', 'ANT-Open-Slide');
// Deck-specific internal metadata that the artefact API must never expose
// or allow to be edited through the file routes. Generic path-safety lives
// in artefact-fs.ts; these belong here because only decks own a manifest +
// audit trail.
const INTERNAL_SEGMENTS = new Set(['.ant-deck']);
const MANIFEST_FILENAME = '.ant-deck.json';
const AUDIT_REL_PATH = '.ant-deck/audit.jsonl';
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

// Re-export the path-safety helpers so existing import sites keep working.
// Wave 2 (sheets, docs) should import directly from artefact-fs.ts.
export { assertSafeDeckSlug };

export interface DeckMeta {
  slug: string;
  title: string;
  deck_dir: string;
  owner_session_id: string;
  allowed_room_ids: string[];
  dev_port: number | null;
  created_at: number | null;
  updated_at: number | null;
}

export interface DeckFileEntry {
  path: string;
  kind: 'file' | 'dir';
  size: number;
  mtime_ms: number;
}

export interface DeckFileSnapshot {
  path: string;
  size: number;
  mtime_ms: number;
  sha256: string;
}

export interface DeckManifest {
  schema_version: 1;
  kind: 'ant-open-slide-deck';
  slug: string;
  title: string;
  deck_dir: string;
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
  files: DeckFileSnapshot[];
}

export interface DeckManifestInput {
  source_session_id?: string | null;
  source_evidence_hash?: string | null;
  generator?: {
    name: string;
    version: string;
  };
}

export interface DeckAuditEvent {
  ts: string;
  deck_slug: string;
  type: string;
  actor: string;
  path?: string | null;
  details?: Record<string, unknown>;
}

export interface DeckWriteGuard {
  base_hash?: string | null;
  if_match_mtime?: number | null;
  actor?: string | null;
}

export class DeckConflictError extends Error {
  code = 'DECK_CONFLICT';
  status = 409;
  details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'DeckConflictError';
    this.details = details;
  }
}

export interface RegisterDeckInput {
  slug: string;
  owner_session_id?: string;
  allowed_room_ids?: string[];
  deck_dir?: string | null;
  dev_port?: number | null;
}

export function openSlideRoot(): string {
  return process.env.ANT_OPEN_SLIDE_DIR || DEFAULT_OPEN_SLIDE_DIR;
}

export function deckMaxFileBytes(): number {
  const raw = Number(process.env.ANT_DECK_MAX_FILE_BYTES);
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

export function defaultDeckDirForSlug(slug: string): string {
  const safe = assertSafeDeckSlug(slug);
  const root = resolve(openSlideRoot());
  const deckDir = resolve(root, safe);
  assertInside(root, deckDir);
  return deckDir;
}

function normaliseDeckDir(input: string | null | undefined, slug: string): string {
  const root = resolve(openSlideRoot());
  const deckDir = resolve(input || defaultDeckDirForSlug(slug));
  assertInside(root, deckDir);
  return deckDir;
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

function manifestPath(deck: DeckMeta): string {
  return join(deck.deck_dir, MANIFEST_FILENAME);
}

function auditPath(deck: DeckMeta): string {
  return join(deck.deck_dir, AUDIT_REL_PATH);
}

function roomSet(ownerSessionId: string, roomIds: string[] | undefined): string[] {
  const rooms = new Set<string>();
  rooms.add(ownerSessionId);
  for (const id of roomIds ?? []) {
    if (typeof id === 'string' && id.trim()) rooms.add(id.trim());
  }
  return Array.from(rooms);
}

function rowToDeck(row: any): DeckMeta {
  const slug = String(row.slug);
  const ownerSessionId = typeof row.owner_session_id === 'string' ? row.owner_session_id : '';
  return {
    slug,
    title: titleFromSlug(slug),
    deck_dir: String(row.deck_dir),
    owner_session_id: ownerSessionId,
    allowed_room_ids: roomSet(ownerSessionId, parseRoomIds(row.allowed_room_ids)),
    dev_port: typeof row.dev_port === 'number' ? row.dev_port : row.dev_port == null ? null : Number(row.dev_port),
    created_at: typeof row.created_at === 'number' ? row.created_at : Number(row.created_at) || null,
    updated_at: typeof row.updated_at === 'number' ? row.updated_at : Number(row.updated_at) || null,
  };
}

export function readDeckMeta(slug: string): DeckMeta | null {
  const safe = assertSafeDeckSlug(slug);
  const row = queries.getDeck(safe);
  if (!row) return null;
  return rowToDeck(row);
}

export function registerDeck(input: RegisterDeckInput): DeckMeta {
  const slug = assertSafeDeckSlug(input.slug);
  const previous = readDeckMeta(slug);
  const ownerSessionId = input.owner_session_id ?? previous?.owner_session_id;
  if (!ownerSessionId) throw new Error('Deck owner_session_id required');
  const allowedRoomIds = roomSet(ownerSessionId, input.allowed_room_ids ?? previous?.allowed_room_ids ?? []);
  const deckDir = normaliseDeckDir(input.deck_dir ?? previous?.deck_dir, slug);
  mkdirSync(deckDir, { recursive: true });

  queries.upsertDeck({
    slug,
    owner_session_id: ownerSessionId,
    allowed_room_ids: JSON.stringify(allowedRoomIds),
    deck_dir: deckDir,
    dev_port: input.dev_port ?? previous?.dev_port ?? null,
    now_ms: Date.now(),
  });

  const deck = readDeckMeta(slug);
  if (!deck) throw new Error('Failed to register deck');
  return deck;
}

export function listDecks(): DeckMeta[] {
  return (queries.listDecks() as any[]).map(rowToDeck);
}

// Deck-flavoured cleaner: artefact-fs provides the generic version, but
// decks layer on the manifest + .ant-deck/ rejection so file API callers
// can't reach into internal metadata.
function cleanDeckPath(path: string): string {
  const raw = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (raw.includes('\0') || /[\x00-\x1F\x7F]/.test(raw)) {
    throw new Error('Deck path contains invalid bytes');
  }
  if (raw.includes('../') || raw === '..' || raw.startsWith('..')) {
    throw new Error('Path traversal is not allowed');
  }
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error('Path traversal is not allowed');
    if (BLOCKED_SEGMENTS.has(part)) throw new Error(`Deck path segment "${part}" is not editable`);
    if (INTERNAL_SEGMENTS.has(part) || part === MANIFEST_FILENAME) {
      throw new Error('Deck internal metadata is not editable through the file API');
    }
    parts.push(part);
  }
  return parts.join('/');
}

export function resolveDeckFile(deck: DeckMeta, path: string): { relPath: string; absPath: string } {
  const relPath = cleanDeckPath(path);
  if (!relPath) throw new Error('Deck file path required');
  const absPath = resolve(deck.deck_dir, relPath);
  assertInside(deck.deck_dir, absPath);
  assertNoSymlinkSegments(deck.deck_dir, relPath);
  return { relPath, absPath };
}

export function listDeckFiles(deck: DeckMeta): DeckFileEntry[] {
  if (!existsSync(deck.deck_dir)) throw new Error('Deck not found');
  const rows: DeckFileEntry[] = [];

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

  walk(deck.deck_dir);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

export function readDeckTextFile(deck: DeckMeta, path: string): { path: string; content: string; size: number; updated_at: string } {
  const resolved = resolveDeckFile(deck, path);
  const stat = statSync(resolved.absPath);
  if (!stat.isFile()) throw new Error('Deck path is not a file');
  if (stat.size > deckMaxFileBytes()) throw new Error('Deck file exceeds max size');
  return {
    path: resolved.relPath,
    content: readFileSync(resolved.absPath, 'utf8'),
    size: stat.size,
    updated_at: stat.mtime.toISOString(),
  };
}

export function readDeckBytes(deck: DeckMeta, path: string): { path: string; bytes: Buffer; size: number; mtime_ms: number; sha256: string } {
  const resolved = resolveDeckFile(deck, path);
  const stat = statSync(resolved.absPath);
  if (!stat.isFile()) throw new Error('Deck path is not a file');
  if (stat.size > deckMaxFileBytes()) throw new Error('Deck file exceeds max size');
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
  if (!stat.isFile()) throw new Error('Deck path is not a file');
  const bytes = readFileSync(absPath);
  return {
    exists: true,
    sha256: sha256Bytes(bytes),
    mtime_ms: stat.mtimeMs,
  };
}

function assertWriteGuard(deck: DeckMeta, path: string, absPath: string, guard: DeckWriteGuard | undefined): void {
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

  recordDeckAudit(deck, {
    type: 'conflict',
    actor: guard?.actor || 'unknown',
    path,
    details,
  });
  throw new DeckConflictError('Deck file changed since caller base; refusing to overwrite', details);
}

export function writeDeckBytes(
  deck: DeckMeta,
  path: string,
  bytes: Buffer | Uint8Array,
  options: DeckWriteGuard = {},
): { path: string; size: number; mtime_ms: number; sha256: string; manifest: DeckManifest } {
  if (bytes.byteLength > deckMaxFileBytes()) throw new Error('Deck file exceeds max size');
  const resolved = resolveDeckFile(deck, path);
  assertWriteGuard(deck, resolved.relPath, resolved.absPath, options);
  mkdirSync(dirname(resolved.absPath), { recursive: true });
  writeFileSync(resolved.absPath, bytes);
  const stat = statSync(resolved.absPath);
  const sha256 = sha256Bytes(bytes);
  const manifest = writeDeckManifest(deck);
  recordDeckAudit(deck, {
    type: 'file_write',
    actor: options.actor || 'unknown',
    path: resolved.relPath,
    details: { size: stat.size, mtime_ms: stat.mtimeMs, sha256 },
  });
  return { path: resolved.relPath, size: stat.size, mtime_ms: stat.mtimeMs, sha256, manifest };
}

export function writeDeckTextFile(deck: DeckMeta, path: string, content: string): { path: string; size: number; updated_at: string } {
  const resolved = resolveDeckFile(deck, path);
  mkdirSync(dirname(resolved.absPath), { recursive: true });
  writeFileSync(resolved.absPath, content, 'utf8');
  const stat = statSync(resolved.absPath);
  return { path: resolved.relPath, size: stat.size, updated_at: stat.mtime.toISOString() };
}

export function deleteDeckPath(deck: DeckMeta, path: string, options: DeckWriteGuard = {}): { path: string; manifest: DeckManifest } {
  const resolved = resolveDeckFile(deck, path);
  assertWriteGuard(deck, resolved.relPath, resolved.absPath, options);
  const stat = statSync(resolved.absPath);
  if (stat.isDirectory()) throw new Error('Deleting directories is not supported');
  rmSync(resolved.absPath, { recursive: true, force: true });
  const manifest = writeDeckManifest(deck);
  recordDeckAudit(deck, {
    type: 'file_delete',
    actor: options.actor || 'unknown',
    path: resolved.relPath,
  });
  return { path: resolved.relPath, manifest };
}

export function readDeckManifest(deck: DeckMeta): DeckManifest | null {
  const path = manifestPath(deck);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'ant-open-slide-deck') return null;
    return parsed as DeckManifest;
  } catch {
    return null;
  }
}

export function deckFileSnapshots(deck: DeckMeta): DeckFileSnapshot[] {
  const snapshots: DeckFileSnapshot[] = [];
  for (const entry of listDeckFiles(deck)) {
    if (entry.kind !== 'file') continue;
    const resolved = resolveDeckFile(deck, entry.path);
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

export function writeDeckManifest(deck: DeckMeta, input: DeckManifestInput = {}): DeckManifest {
  const previous = readDeckManifest(deck);
  const now = new Date().toISOString();
  const manifest: DeckManifest = {
    schema_version: 1,
    kind: 'ant-open-slide-deck',
    slug: deck.slug,
    title: deck.title,
    deck_dir: deck.deck_dir,
    owner_session_id: deck.owner_session_id,
    allowed_room_ids: deck.allowed_room_ids,
    dev_port: deck.dev_port,
    source_session_id: input.source_session_id ?? previous?.source_session_id ?? deck.owner_session_id ?? null,
    source_evidence_hash: input.source_evidence_hash ?? previous?.source_evidence_hash ?? null,
    generator: input.generator ?? previous?.generator ?? { name: 'ant-open-slide', version: '1' },
    generated_at: previous?.generated_at ?? now,
    updated_at: now,
    files: deckFileSnapshots(deck),
  };
  writeFileSync(manifestPath(deck), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

export function recordDeckAudit(deck: DeckMeta, event: Omit<DeckAuditEvent, 'ts' | 'deck_slug'> & { ts?: string }): DeckAuditEvent {
  const row: DeckAuditEvent = {
    ts: event.ts ?? new Date().toISOString(),
    deck_slug: deck.slug,
    type: event.type,
    actor: event.actor,
    path: event.path ?? null,
    details: event.details ?? {},
  };
  const path = auditPath(deck);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + '\n', 'utf8');
  appendDeckAuditRunEvent(deck, row);
  return row;
}

function appendDeckAuditRunEvent(deck: DeckMeta, row: DeckAuditEvent): void {
  if (!deck.owner_session_id) return;
  const tsMs = Date.parse(row.ts);
  const details = row.details ?? {};
  const kind = row.type === 'conflict' ? 'artifact_conflict' : 'artifact_write';
  const text = row.path
    ? `${row.type} ${deck.slug}/${row.path}`
    : `${row.type} ${deck.slug}`;
  const payload = {
    deck_slug: deck.slug,
    deck_dir: deck.deck_dir,
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
    manifest_path: manifestPath(deck),
    audit_path: auditPath(deck),
  };
  try {
    const eventRow = queries.appendRunEvent(
      deck.owner_session_id,
      Number.isFinite(tsMs) ? tsMs : Date.now(),
      'json',
      'high',
      kind,
      text,
      JSON.stringify(payload),
      `deck_audit:${deck.slug}:${row.ts}:${row.type}:${row.path ?? ''}`,
    ) as any;
    broadcast(deck.owner_session_id, {
      type: 'run_event_created',
      sessionId: deck.owner_session_id,
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
    // evidence projection and must not break deck writes.
  }
}

export function readDeckAudit(deck: DeckMeta, limit = 100): DeckAuditEvent[] {
  const path = auditPath(deck);
  if (!existsSync(path)) return [];
  const max = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 100;
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-max)
    .map((line) => {
      try {
        return JSON.parse(line) as DeckAuditEvent;
      } catch {
        return null;
      }
    })
    .filter((row): row is DeckAuditEvent => Boolean(row));
}
