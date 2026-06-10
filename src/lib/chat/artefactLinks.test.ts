import { describe, expect, it } from 'vitest';
import { hrefForRoomArtefact } from './artefactLinks';

describe('hrefForRoomArtefact', () => {
  it('opens tracker artefacts directly on the standalone live tracker page', () => {
    expect(hrefForRoomArtefact({
      id: 'art_1',
      kind: 'tracker',
      refUrl: '/rooms/room-a/trackers/trk_gvpl4'
    })).toBe('/rooms/room-a/trackers/trk_gvpl4');
  });

  it('falls back to the artefact shell for non-trackers and malformed tracker refs', () => {
    expect(hrefForRoomArtefact({ id: 'art_doc', kind: 'doc', refUrl: '/docs/example' })).toBe('/artefacts/art_doc');
    expect(hrefForRoomArtefact({ id: 'art_bad', kind: 'tracker', refUrl: 'https://example.com/tracker' })).toBe('/artefacts/art_bad');
  });
});
