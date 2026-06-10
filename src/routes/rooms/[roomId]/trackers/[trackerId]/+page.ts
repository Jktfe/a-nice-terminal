import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { TrackerView } from '$lib/server/trackerStore';

// Passthrough view (JWPK msg_go3s64r7q4): SSR-load the live tracker so the
// standalone page has the title + initial data; the TrackerTable widget then
// refreshes from the same store, so this is a window onto the live tracker,
// not a copy.
export const load: PageLoad = async ({ fetch, params }) => {
  const response = await fetch(
    `/api/chat-rooms/${encodeURIComponent(params.roomId)}/trackers/${encodeURIComponent(params.trackerId)}`
  );
  if (!response.ok) {
    if (response.status === 404) throw error(404, 'Tracker not found.');
    throw error(response.status, `Could not load tracker (${response.status}).`);
  }
  const body = (await response.json()) as { tracker: TrackerView };
  return {
    roomId: params.roomId,
    trackerId: params.trackerId,
    tracker: body.tracker
  };
};
