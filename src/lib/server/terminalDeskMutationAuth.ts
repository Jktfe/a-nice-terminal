import { error } from '@sveltejs/kit';
import { resolveTerminalCallerHandle } from './authGate';
import { getOperatorHandle } from './operatorHandle';
import { getTerminalRecord, type TerminalRecord } from './terminalRecordsStore';
import { canManageTerminalDesk } from './terminalDeskFacade';

export type TerminalDeskMutationActor = {
  actor: string;
  record: TerminalRecord;
};

export function requireTerminalDeskMutationActor(request: Request, deskId: string): TerminalDeskMutationActor {
  const record = getTerminalRecord(deskId);
  if (!record) throw error(404, 'Desk not found.');
  const actor = resolveTerminalCallerHandle(request);
  if (!actor) throw error(401, 'browser-session or admin-bearer required.');
  if (!canManageTerminalDesk({ actor, record, operatorHandle: getOperatorHandle() })) {
    throw error(403, `caller ${actor} cannot manage Desk ${deskId}`);
  }
  return { actor, record };
}
