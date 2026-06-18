/**
 * GET   /api/terminals/[id]/settings — read terminal settings from meta JSON.
 *   200 { persistence, writeGrants, killDefault, deliveryMode, deliveryTargetMode, coOwners }
 * PATCH /api/terminals/[id]/settings — patch a single field.
 *   Body: { field: 'persistence'|'writeGrants'|'killDefault'|'deliveryMode'|'deliveryTargetMode'|'coOwners', value: ... }
 *   200 { ok: true }
 *
 * JWPK msg_fdi280krd3 (2026-05-19) — TerminalSettingsModal UI was wired
 * to this endpoint (7e7c254) but the endpoint didn't exist; PATCH 404'd
 * and the UI looked saved but nothing persisted. This closes the loop.
 * Fanout enforcement of deliveryTargetMode is in pty-inject-fanout.ts.
 *
 * killDefault added per JWPK msg_t42mq5ma6u (2026-05-19): per-terminal
 * default disposition for the kill action so the operator doesn't see the
 * confirm modal every time. 'prompt' = always show, 'archive' / 'delete' /
 * 'just-kill' = skip modal and POST kill with that mode directly.
 *
 * Auth: admin-bearer OR browser-session (same model as other write paths).
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { getTerminalById, upsertTerminal } from '$lib/server/terminalsStore';
import { getTerminalRecord, parseAllowlist, updateTerminalRecord } from '$lib/server/terminalRecordsStore';
import {
  isTerminalDeliveryMode,
  isTerminalDeliveryTargetMode,
  TERMINAL_DELIVERY_MODES,
  TERMINAL_DELIVERY_TARGET_MODES,
  type TerminalDeliveryMode,
  type TerminalDeliveryTargetMode
} from '$lib/server/terminalDeliveryMode';

type KillDefault = 'prompt' | 'archive' | 'delete' | 'just-kill';

type Settings = {
  persistence: 'forever' | '7d' | '24h' | '1h';
  coOwners: string[];
  writeGrants: Array<{ handle: string; mode: 'read' | 'read_write' }>;
  killDefault: KillDefault;
  deliveryMode: TerminalDeliveryMode;
  deliveryTargetMode: TerminalDeliveryTargetMode;
};

const DEFAULT_SETTINGS: Settings = {
  persistence: 'forever',
  coOwners: [],
  writeGrants: [],
  killDefault: 'prompt',
  deliveryMode: 'inject',
  deliveryTargetMode: 'room_flow'
};

const KILL_DEFAULT_VALUES: readonly KillDefault[] = ['prompt', 'archive', 'delete', 'just-kill'];

function requireWriteAuth(request: Request): void {
  if (resolveCallerHandleAnyRoom(request)) return;
  try {
    requireAdminAuth(request);
    return;
  } catch {
    /* fall through */
  }
  throw error(401, 'browser-session or admin-bearer required');
}

function parseMeta(metaRaw: string | undefined): Record<string, unknown> {
  if (!metaRaw || metaRaw.length === 0) return {};
  try {
    const parsed = JSON.parse(metaRaw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normaliseHandle(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const withAt = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  return withAt.toLowerCase();
}

function normaliseHandleList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.flatMap((value) => {
    if (typeof value !== 'string') return [];
    const handle = normaliseHandle(value);
    return handle ? [handle] : [];
  }))];
}

function settingsFromMeta(meta: Record<string, unknown>, recordAllowlist: string[] | null): Settings {
  const persistence = typeof meta.persistence === 'string'
    && ['forever', '7d', '24h', '1h'].includes(meta.persistence as string)
    ? meta.persistence as Settings['persistence']
    : DEFAULT_SETTINGS.persistence;
  const coOwners = recordAllowlist && recordAllowlist.length > 0
    ? normaliseHandleList(recordAllowlist)
    : normaliseHandleList(meta.coOwners);
  const writeGrants = Array.isArray(meta.writeGrants)
    ? meta.writeGrants
        .filter((g): g is { handle: string; mode: 'read' | 'read_write' } =>
          !!g && typeof g === 'object'
          && typeof (g as { handle?: unknown }).handle === 'string'
          && ((g as { mode?: unknown }).mode === 'read' || (g as { mode?: unknown }).mode === 'read_write'))
    : DEFAULT_SETTINGS.writeGrants;
  const killDefault = typeof meta.killDefault === 'string'
    && (KILL_DEFAULT_VALUES as readonly string[]).includes(meta.killDefault)
    ? meta.killDefault as KillDefault
    : DEFAULT_SETTINGS.killDefault;
  const deliveryMode = isTerminalDeliveryMode(meta.deliveryMode)
    ? meta.deliveryMode
    : DEFAULT_SETTINGS.deliveryMode;
  const deliveryTargetMode = isTerminalDeliveryTargetMode(meta.deliveryTargetMode)
    ? meta.deliveryTargetMode
    : DEFAULT_SETTINGS.deliveryTargetMode;
  return { persistence, coOwners, writeGrants, killDefault, deliveryMode, deliveryTargetMode };
}

export const GET: RequestHandler = ({ params }) => {
  const id = params.id ?? '';
  if (!id) throw error(400, 'id required.');
  const terminal = getTerminalById(id);
  if (!terminal) throw error(404, 'terminal not found.');
  const record = getTerminalRecord(id);
  const meta = parseMeta(typeof terminal.meta === 'string' ? terminal.meta : undefined);
  return json(settingsFromMeta(meta, parseAllowlist(record?.allowlist ?? null)));
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  requireWriteAuth(request);
  const id = params.id ?? '';
  if (!id) throw error(400, 'id required.');
  const terminal = getTerminalById(id);
  if (!terminal) throw error(404, 'terminal not found.');

  // IDOR fix (msg_53bpcfqe9j pre-launch code review): requireWriteAuth
  // confirms the caller has *some* valid session, but does not check
  // that the caller owns this terminal. Without this, any authenticated
  // browser-session could PATCH another operator's terminal — granting
  // themselves writeGrants, changing coOwners, flipping killDefault
  // to drop the transcript silently.
  //
  // Owner = terminal_records.created_by OR terminal_records.handle.
  // Admin-bearer bypasses the ownership check (operator override).
  //
  // resolveCallerHandleAnyRoom returns null when only admin-bearer is
  // present (no session-handle on the request) — that's the admin path
  // and stays unrestricted. When a session handle IS resolved, it must
  // match the terminal owner.
  const callerHandle = resolveCallerHandleAnyRoom(request);
  if (callerHandle) {
    const record = getTerminalRecord(id);
    const owners = new Set<string>();
    if (record?.created_by) owners.add(record.created_by.toLowerCase());
    if (record?.handle) owners.add(record.handle.toLowerCase());
    for (const coOwner of parseAllowlist(record?.allowlist ?? null) ?? []) {
      owners.add(coOwner.toLowerCase());
    }
    const terminalMeta = parseMeta(typeof terminal.meta === 'string' ? terminal.meta : undefined);
    for (const coOwner of normaliseHandleList(terminalMeta.coOwners)) {
      owners.add(coOwner.toLowerCase());
    }
    // Terminals predating the created_by/handle columns have neither;
    // allow the caller as long as they registered against this terminal
    // (their pidChain resolved to a session-handle, which means there's
    // SOMEONE who can plausibly own it). Until back-fill, we lean
    // permissive on null-owner rows; record this so back-fill is a
    // tracked follow-up.
    if (owners.size > 0 && !owners.has(callerHandle.toLowerCase())) {
      throw error(403, `caller ${callerHandle} does not own terminal ${id}`);
    }
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') throw error(400, 'JSON body required.');
  const field = body.field;
  if (
    field !== 'persistence'
    && field !== 'coOwners'
    && field !== 'writeGrants'
    && field !== 'killDefault'
    && field !== 'deliveryMode'
    && field !== 'deliveryTargetMode'
  ) {
    throw error(400, 'field must be persistence | coOwners | writeGrants | killDefault | deliveryMode | deliveryTargetMode.');
  }
  if (field === 'coOwners' && !Array.isArray(body.value)) {
    throw error(400, 'coOwners must be an array of handles.');
  }
  if (field === 'killDefault'
      && !(typeof body.value === 'string'
           && (KILL_DEFAULT_VALUES as readonly string[]).includes(body.value))) {
    throw error(400, 'killDefault must be one of prompt | archive | delete | just-kill.');
  }
  if (field === 'deliveryMode' && !isTerminalDeliveryMode(body.value)) {
    throw error(400, `deliveryMode must be one of ${TERMINAL_DELIVERY_MODES.join(' | ')}.`);
  }
  if (field === 'deliveryTargetMode' && !isTerminalDeliveryTargetMode(body.value)) {
    throw error(400, `deliveryTargetMode must be one of ${TERMINAL_DELIVERY_TARGET_MODES.join(' | ')}.`);
  }
  const existingMeta = parseMeta(typeof terminal.meta === 'string' ? terminal.meta : undefined);
  const value = field === 'coOwners' ? normaliseHandleList(body.value) : body.value;
  if (field === 'coOwners') {
    updateTerminalRecord(id, { allowlist: value as string[] });
  }
  // Trust the UI's shape — server-side validation in settingsFromMeta drops
  // garbage on next read. Write-grants gets normalised on read too.
  const nextMeta = { ...existingMeta, [field]: value };
  upsertTerminal({
    pid: terminal.pid,
    pid_start: terminal.pid_start ?? '',
    name: terminal.name ?? '',
    source: terminal.source ?? '',
    meta: nextMeta
  });
  return json({ ok: true });
};
