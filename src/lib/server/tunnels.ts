import { queries } from './db.js';

export type SiteTunnelStatus = 'linked' | 'live' | 'offline' | 'blocked' | 'unknown';

export interface SiteTunnelMeta {
  slug: string;
  title: string;
  public_url: string;
  local_url: string | null;
  owner_session_id: string;
  allowed_room_ids: string[];
  status: SiteTunnelStatus;
  access_required: boolean;
  created_at: number | null;
  updated_at: number | null;
}

export interface RegisterSiteTunnelInput {
  slug: string;
  title?: string | null;
  public_url: string;
  local_url?: string | null;
  owner_session_id?: string;
  allowed_room_ids?: string[];
  status?: string | null;
  access_required?: boolean | number | null;
}

export function assertSafeTunnelSlug(slug: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(slug)) {
    throw new Error('Invalid tunnel slug');
  }
  return slug;
}

export function parseRoomIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  }
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return parseRoomIds(parsed);
  } catch {
    return raw.split(',').map((id) => id.trim()).filter(Boolean);
  }
}

function titleFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normaliseUrl(value: string, field: string): string {
  const raw = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${field} must be a valid http(s) URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${field} must be a valid http(s) URL`);
  }
  return parsed.toString();
}

function normaliseOptionalUrl(value: string | null | undefined, field: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return normaliseUrl(value, field);
}

function normaliseStatus(value: string | null | undefined): SiteTunnelStatus {
  const status = (value || 'linked').trim().toLowerCase();
  if (status === 'linked' || status === 'live' || status === 'offline' || status === 'blocked' || status === 'unknown') {
    return status;
  }
  return 'linked';
}

function roomSet(ownerSessionId: string, roomIds: string[] | undefined): string[] {
  const rooms = new Set<string>();
  rooms.add(ownerSessionId);
  for (const id of roomIds ?? []) {
    if (typeof id === 'string' && id.trim()) rooms.add(id.trim());
  }
  return Array.from(rooms);
}

function rowToSiteTunnel(row: any): SiteTunnelMeta {
  const slug = String(row.slug);
  const ownerSessionId = typeof row.owner_session_id === 'string' ? row.owner_session_id : '';
  return {
    slug,
    title: typeof row.title === 'string' && row.title.trim() ? row.title : titleFromSlug(slug),
    public_url: String(row.public_url),
    local_url: typeof row.local_url === 'string' && row.local_url.trim() ? row.local_url : null,
    owner_session_id: ownerSessionId,
    allowed_room_ids: roomSet(ownerSessionId, parseRoomIds(row.allowed_room_ids)),
    status: normaliseStatus(row.status),
    access_required: Boolean(row.access_required),
    created_at: typeof row.created_at === 'number' ? row.created_at : Number(row.created_at) || null,
    updated_at: typeof row.updated_at === 'number' ? row.updated_at : Number(row.updated_at) || null,
  };
}

export function readSiteTunnelMeta(slug: string): SiteTunnelMeta | null {
  const safe = assertSafeTunnelSlug(slug);
  const row = queries.getSiteTunnel(safe);
  if (!row) return null;
  return rowToSiteTunnel(row);
}

export function registerSiteTunnel(input: RegisterSiteTunnelInput): SiteTunnelMeta {
  const slug = assertSafeTunnelSlug(input.slug);
  const previous = readSiteTunnelMeta(slug);
  const ownerSessionId = input.owner_session_id ?? previous?.owner_session_id;
  if (!ownerSessionId) throw new Error('Tunnel owner_session_id required');
  const publicUrl = normaliseUrl(input.public_url ?? previous?.public_url ?? '', 'public_url');
  const localUrl = normaliseOptionalUrl(input.local_url ?? previous?.local_url ?? null, 'local_url');
  const allowedRoomIds = roomSet(ownerSessionId, input.allowed_room_ids ?? previous?.allowed_room_ids ?? []);

  const accessRequired = input.access_required === undefined || input.access_required === null
    ? Boolean(previous?.access_required)
    : input.access_required === true || input.access_required === 1;

  queries.upsertSiteTunnel({
    slug,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : previous?.title ?? titleFromSlug(slug),
    public_url: publicUrl,
    local_url: localUrl,
    owner_session_id: ownerSessionId,
    allowed_room_ids: JSON.stringify(allowedRoomIds),
    status: normaliseStatus(input.status ?? previous?.status ?? 'linked'),
    access_required: accessRequired ? 1 : 0,
    now_ms: Date.now(),
  });

  const tunnel = readSiteTunnelMeta(slug);
  if (!tunnel) throw new Error('Failed to register tunnel');
  return tunnel;
}

export function listSiteTunnels(): SiteTunnelMeta[] {
  return (queries.listSiteTunnels() as any[]).map(rowToSiteTunnel);
}
