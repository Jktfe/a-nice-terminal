/**
 * trackerRouteHelpers — shared shaping for the tracker API routes:
 * the ant-tracker create-receipt fence and the cell-level audit chat events.
 *
 * The audit-of-changes (JWPK msg_p28s81vbyz) lives in TWO places: the store's
 * append-only event log (queried by the widget's 🕓 history) AND a system
 * message per change in the room transcript (the chat IS the ledger). These
 * helpers format the latter.
 */

import { postSystemMessage } from './chatMessageStore';
import { createArtefactInRoom } from './chatRoomArtefactStore';
import type { TrackerColumn } from './trackerStore';

/** The create-receipt: a fenced ant-tracker block (id-only) → renders the live table inline. */
export function postTrackerCreateReceipt(roomId: string, trackerId: string, title: string, byHandle: string): void {
  postSystemMessage({
    roomId,
    body: `📋 Tracker opened by ${byHandle}: ${title}\n\n\`\`\`ant-tracker\n${trackerId}\n\`\`\``
  });
}

export function postRowAddedEvent(roomId: string, title: string, byHandle: string): void {
  postSystemMessage({ roomId, body: `📋 ${byHandle} added a row to ${title}.` });
}

/** Cell-change audit line — the per-change chat event with full old→new provenance. */
export function postCellSetEvent(
  roomId: string,
  title: string,
  columnLabel: string,
  oldValue: string,
  newValue: string,
  byHandle: string
): void {
  const from = oldValue.trim().length > 0 ? `"${oldValue}"` : '(empty)';
  const to = newValue.trim().length > 0 ? `"${newValue}"` : '(empty)';
  postSystemMessage({
    roomId,
    body: `📋 ${byHandle} set ${title} · ${columnLabel}: ${from} → ${to}`
  });
}

/** Parse the /tracker grammar's column spec: "Beneficiary, Quantum(£), Paid(y/n)". */
const TYPE_ALIASES: Record<string, TrackerColumn['type']> = {
  '£': 'currency', '$': 'currency', currency: 'currency', money: 'currency',
  num: 'number', number: 'number', '#': 'number',
  date: 'date',
  'y/n': 'bool', yn: 'bool', bool: 'bool', boolean: 'bool', checkbox: 'bool',
  link: 'link', url: 'link',
  text: 'text', string: 'text'
};

export function parseColumnSpec(spec: string): Array<{ label: string; type?: TrackerColumn['type'] }> {
  return spec
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const m = part.match(/^(.*?)\s*[\(:]\s*([^)]*)\)?\s*$/);
      if (m && m[2]) {
        const label = m[1].trim();
        const type = TYPE_ALIASES[m[2].trim().toLowerCase()];
        if (label.length > 0) return { label, type };
      }
      return { label: part };
    });
}

/**
 * Register a tracker in the room's artefacts panel (JWPK msg_g4ttgnn65i:
 * "attached as artefacts so you don't need to scroll through chats to find
 * them"). The refUrl opens the standalone tracker view, which renders the
 * live table via the same TrackerTable widget.
 */
export function registerTrackerArtefact(roomId: string, trackerId: string, title: string, byHandle: string): void {
  createArtefactInRoom({
    roomId,
    kind: 'tracker',
    title,
    refUrl: `/rooms/${roomId}/trackers/${trackerId}`,
    createdBy: byHandle
  });
}
