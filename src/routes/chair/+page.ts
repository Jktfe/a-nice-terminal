import type { PageLoad } from './$types';
import type { ChairRowDigest } from '$lib/server/chairStore';
import type { ChairDigestNote } from '$lib/server/chairDigestNoteStore';

export const load: PageLoad = async ({ fetch }) => {
  const [digestResponse, notesResponse, chairEnabledResponse] = await Promise.all([
    fetch('/api/chair'),
    fetch('/api/chair/notes'),
    fetch('/api/chair-enabled')
  ]);

  const chairEnabled = chairEnabledResponse.ok
    ? ((await chairEnabledResponse.json()) as { enabled: boolean }).enabled
    : true;

  if (!digestResponse.ok) {
    return {
      digestRowsFromServer: [] as ChairRowDigest[],
      notesFromServer: [] as ChairDigestNote[],
      digestFetchFailed: true,
      chairEnabled,
      refreshedAt: new Date().toISOString()
    };
  }

  const digestBody = (await digestResponse.json()) as { chairDigest: ChairRowDigest[] };
  const notesBody = notesResponse.ok
    ? ((await notesResponse.json()) as { notes: ChairDigestNote[] })
    : { notes: [] as ChairDigestNote[] };

  return {
    digestRowsFromServer: digestBody.chairDigest ?? [],
    notesFromServer: notesBody.notes ?? [],
    digestFetchFailed: false,
    chairEnabled,
    refreshedAt: new Date().toISOString()
  };
};
