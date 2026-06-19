import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getArtefact } from '$lib/server/chatRoomArtefactStore';
import { getArtefactContentByArtefactId } from '$lib/server/chatRoomArtefactContentStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';

export const load: PageServerLoad = async ({ params, request }) => {
  const artefact = getArtefact(params.artefactId);
  if (!artefact) throw error(404, 'Artefact not found.');
  const room = findChatRoomById(artefact.roomId);
  if (!room) throw error(404, 'Artefact room not found.');
  await requireChatRoomReadAccess(request, room);
  // F-Univer slice (JWPK msg_qu7iikjd55 2026-05-26): load the artefact body
  // so the client-side Univer viewer can render univer-json content
  // without a second round-trip. Returns null for artefacts that don't
  // have a body row yet (the canvas seeds an empty snapshot in that case).
  const content = getArtefactContentByArtefactId(params.artefactId);
  return { artefact, content };
};
