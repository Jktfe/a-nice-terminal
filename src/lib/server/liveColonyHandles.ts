/**
 * The LIVE ANThandles in the colony — alive sessions ∩ terminal records, minus
 * the operator's own handle. This is the SINGLE SOURCE OF TRUTH shared by the
 * helper pairing dropdown (GET /api/helper/handles) and the mint gate
 * (POST /api/helper/pairing) so the list and the gate can NEVER disagree.
 *
 * JWPK 2026-06-13: the earlier split — dropdown = invite-accepted handles,
 * gate = handles.owners[] — let a handle appear in the list yet 403 at mint
 * (@fableCD). One source kills that whole class of bug. "Live" here is exactly
 * what the terminals page shows live (the CLIs / MCPs / terminals).
 */
import { listTerminals } from './ptyClient';
import { listTerminalRecords, deriveHandle } from './terminalRecordsStore';
import { isOperatorHandle } from './operatorHandle';

export async function listLiveColonyHandles(): Promise<string[]> {
  const aliveSet = new Set(await listTerminals());
  const seen = new Set<string>();
  const handles: string[] = [];
  for (const record of listTerminalRecords()) {
    if (!aliveSet.has(record.session_id)) continue;
    const handle = deriveHandle(record);
    // You don't pair yourself (the operator handle), and dedupe.
    if (!handle || isOperatorHandle(handle) || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
  }
  handles.sort();
  return handles;
}
