export type RoomArtefactKind = 'plan' | 'deck' | 'doc' | 'sheet' | 'site';

export interface RoomArtefactItem {
  id: string;
  kind: RoomArtefactKind;
  room_id: string;
  title: string;
  href: string;
  status?: string | null;
  subtitle?: string | null;
  updated_at?: string | number | null;
  meta?: Record<string, unknown>;
}

export interface RoomArtefactGroups {
  plans: RoomArtefactItem[];
  decks: RoomArtefactItem[];
  docs: RoomArtefactItem[];
  sheets: RoomArtefactItem[];
  sites: RoomArtefactItem[];
}

export interface RoomArtefactSummary {
  session_id: string;
  room_id: string;
  source_session_id: string | null;
  artefacts: RoomArtefactGroups;
  counts: {
    total: number;
    plans: number;
    decks: number;
    docs: number;
    sheets: number;
    sites: number;
  };
}

export const ROOM_ARTEFACT_GROUPS: Array<{
  key: keyof RoomArtefactGroups;
  kind: RoomArtefactKind;
  label: string;
}> = [
  { key: 'plans', kind: 'plan', label: 'Plans' },
  { key: 'decks', kind: 'deck', label: 'Decks' },
  { key: 'docs', kind: 'doc', label: 'Docs' },
  { key: 'sheets', kind: 'sheet', label: 'Sheets' },
  { key: 'sites', kind: 'site', label: 'Sites' },
];

export function emptyRoomArtefacts(
  sessionId: string,
  roomId: string,
  sourceSessionId: string | null = null,
): RoomArtefactSummary {
  return {
    session_id: sessionId,
    room_id: roomId,
    source_session_id: sourceSessionId,
    artefacts: {
      plans: [],
      decks: [],
      docs: [],
      sheets: [],
      sites: [],
    },
    counts: {
      total: 0,
      plans: 0,
      decks: 0,
      docs: 0,
      sheets: 0,
      sites: 0,
    },
  };
}

export function countRoomArtefacts(groups: RoomArtefactGroups): RoomArtefactSummary['counts'] {
  const plans = groups.plans.length;
  const decks = groups.decks.length;
  const docs = groups.docs.length;
  const sheets = groups.sheets.length;
  const sites = groups.sites.length;
  return {
    plans,
    decks,
    docs,
    sheets,
    sites,
    total: plans + decks + docs + sheets + sites,
  };
}
