type ArtefactLinkInput = {
  id: string;
  kind: string;
  refUrl: string | null;
};

export function hrefForRoomArtefact(entry: ArtefactLinkInput): string {
  if (entry.kind === 'tracker' && entry.refUrl?.startsWith('/rooms/')) {
    return entry.refUrl;
  }
  return `/artefacts/${encodeURIComponent(entry.id)}`;
}
