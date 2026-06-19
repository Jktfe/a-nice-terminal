import { error } from '@sveltejs/kit';
import { resolveCallerHandleAnyRoom } from './authGate';
import { requireAdminAuth } from './chatInviteAuth';
import { getOperatorHandle, canonicaliseOperatorHandle } from './operatorHandle';
import { canCallerActOnTerminal } from './allowlistGuard';
import { getTerminalRecord, parseAllowlist, type TerminalRecord } from './terminalRecordsStore';
import { getTerminalById, type TerminalRow } from './terminalsStore';

type TerminalWriteGrant = { handle: string; mode: 'read' | 'read_write' };

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
  return (trimmed.startsWith('@') ? trimmed : `@${trimmed}`).toLowerCase();
}

function readWriteGrants(meta: Record<string, unknown>): TerminalWriteGrant[] {
  if (!Array.isArray(meta.writeGrants)) return [];
  return meta.writeGrants.flatMap((grant): TerminalWriteGrant[] => {
    if (!grant || typeof grant !== 'object') return [];
    const rawHandle = (grant as { handle?: unknown }).handle;
    if (typeof rawHandle !== 'string') return [];
    const handle = normaliseHandle(rawHandle);
    if (!handle) return [];
    const rawMode = (grant as { mode?: unknown }).mode;
    const mode = rawMode === 'read' ? 'read' : 'read_write';
    return [{ handle, mode }];
  });
}

function hasReadWriteGrant(terminal: TerminalRow | null, callerHandle: string): boolean {
  const meta = parseMeta(typeof terminal?.meta === 'string' ? terminal.meta : undefined);
  const caller = canonicaliseOperatorHandle(callerHandle).toLowerCase();
  return readWriteGrants(meta).some((grant) =>
    grant.mode === 'read_write' && canonicaliseOperatorHandle(grant.handle).toLowerCase() === caller
  );
}

function legacyOwnerlessOperatorFallback(record: TerminalRecord | null, callerHandle: string): boolean {
  if (record) return false;
  return canonicaliseOperatorHandle(callerHandle) === canonicaliseOperatorHandle(getOperatorHandle());
}

export function requireTerminalInputWriteAccess(request: Request, terminalId: string): void {
  if (terminalId.length === 0) throw error(400, 'sessionId required.');

  let isAdminBearer = false;
  try {
    requireAdminAuth(request);
    isAdminBearer = true;
  } catch {
    /* browser-session path below */
  }

  const callerHandle = isAdminBearer ? getOperatorHandle() : resolveCallerHandleAnyRoom(request);
  if (!callerHandle) throw error(401, 'browser-session or admin-bearer required');

  const terminal = getTerminalById(terminalId);
  const record = getTerminalRecord(terminalId);
  if (!terminal && !record) throw error(404, 'terminal not found.');

  if (isAdminBearer) return;
  if (record && canCallerActOnTerminal(callerHandle, record)) return;
  if (hasReadWriteGrant(terminal, callerHandle)) return;
  if (legacyOwnerlessOperatorFallback(record, callerHandle)) return;

  const coOwners = parseAllowlist(record?.allowlist ?? null) ?? [];
  throw error(
    403,
    coOwners.length > 0
      ? `caller ${callerHandle} does not own or have write access to terminal ${terminalId}`
      : `caller ${callerHandle} does not have write access to terminal ${terminalId}`
  );
}
