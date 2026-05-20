import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getArtefact } from '$lib/server/chatRoomArtefactStore';

export const load: PageServerLoad = ({ params }) => {
  const artefact = getArtefact(params.artefactId);
  if (!artefact) throw error(404, 'Artefact not found.');
  return { artefact };
};
