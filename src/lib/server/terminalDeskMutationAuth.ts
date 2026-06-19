import { error } from '@sveltejs/kit';
import { resolveTerminalCallerHandle } from './authGate';
import { getOperatorHandle } from './operatorHandle';
import { resolveOperatorLikeActorHandle } from './operatorLikeAuth';
import { getTerminalRecord, type TerminalRecord } from './terminalRecordsStore';
import { canManageTerminalDesk } from './terminalDeskFacade';

export type TerminalDeskMutationActor = {
  actor: string;
  record: TerminalRecord;
};

export async function requireTerminalDeskMutationActor(request: Request, deskId: string): Promise<TerminalDeskMutationActor> {
  const record = getTerminalRecord(deskId);
  if (!record) throw error(404, 'Desk not found.');
  const actor = (await resolveOperatorLikeActorHandle(request)) ?? resolveTerminalCallerHandle(request);
  if (!actor) throw error(401, 'browser-session or admin-bearer required.');
  if (!canManageTerminalDesk({ actor, record, operatorHandle: getOperatorHandle() })) {
    throw error(403, `caller ${actor} cannot manage Desk ${deskId}`);
  }
  return { actor, record };
}
