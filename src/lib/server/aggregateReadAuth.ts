import { error } from '@sveltejs/kit';
import { resolveCallerHandleAnyRoom } from './authGate';
import { requireAdminAuth } from './chatInviteAuth';
import { ADMIN_BEARER_HANDLE } from './chatRoomAuthGate';
import { parsePidChainFromBody } from './identityGate';
import { lookupTerminalByPidChain } from './terminalsStore';
import { deriveHandle, getTerminalRecord } from './terminalRecordsStore';

function resolvePidChainActor(request: Request, rawBody: unknown): string | null {
  let pidChain = parsePidChainFromBody(rawBody);
  if (pidChain.length === 0) {
    try {
      const raw = new URL(request.url).searchParams.get('pidChain');
      pidChain = raw ? parsePidChainFromBody({ pidChain: JSON.parse(raw) }) : [];
    } catch {
      pidChain = [];
    }
  }
  const terminal = lookupTerminalByPidChain(pidChain);
  if (!terminal) return null;
  const record = getTerminalRecord(terminal.id);
  if (record?.handle && record.handle.trim().length > 0) return record.handle;
  if (record) return deriveHandle(record);
  return `terminal:${terminal.id}`;
}

export function resolveAggregateAuthActor(
  request: Request,
  label = 'aggregate read',
  rawBody: unknown = null
): string {
  const handle = resolveCallerHandleAnyRoom(request);
  if (handle) return handle;
  const pidChainActor = resolvePidChainActor(request, rawBody);
  if (pidChainActor) return pidChainActor;
  try {
    requireAdminAuth(request);
    return ADMIN_BEARER_HANDLE;
  } catch {
    throw error(401, `browser-session, pidChain, or admin-bearer required for ${label}`);
  }
}

export function requireAggregateReadAuth(request: Request, label = 'aggregate read'): void {
  resolveAggregateAuthActor(request, label);
}
