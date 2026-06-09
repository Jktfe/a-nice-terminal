import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist, findChatRoomById } from '$lib/server/chatRoomStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';
import {
  createVote,
  listVotesForRoom
} from '$lib/server/voteStore';
import {
  postVoteReceipts,
  readStringList,
  requiredString,
  voteSummary
} from '$lib/server/voteRouteHelpers';

export const GET: RequestHandler = async ({ url }) => {
  const roomId = url.searchParams.get('roomId');
  if (!roomId) throw error(400, 'roomId query parameter is required.');
  if (!doesChatRoomExist(roomId)) throw error(404, 'Room not found.');
  return json({ votes: listVotesForRoom(roomId) });
};

export const POST: RequestHandler = async ({ request }) => {
  const rawBody = await request.json().catch(() => null);
  if (!rawBody || typeof rawBody !== 'object') throw error(400, 'Send a JSON body.');
  const body = rawBody as Record<string, unknown>;
  const primaryRoomId = requiredString(body.roomId, 'roomId');
  const roomIds = readStringList(body.roomIds);
  const boundRooms = unique([primaryRoomId, ...roomIds]);
  for (const roomId of boundRooms) {
    if (!doesChatRoomExist(roomId)) throw error(404, `Room not found: ${roomId}`);
  }
  const createdByHandle = resolveCallerIdentityStrict(primaryRoomId, request, rawBody);
  const title = requiredString(body.title, 'title');
  const options = readStringList(body.options);
  const explicitVoters = readStringList(body.eligibleVoters ?? body.voters);
  const eligibleVoters = explicitVoters.length > 0
    ? explicitVoters
    : inferEligibleVoters(boundRooms);

  try {
    const vote = createVote({
      title,
      body: typeof body.body === 'string' ? body.body : null,
      options,
      eligibleVoters,
      roomIds: boundRooms,
      createdByHandle
    });
    postVoteReceipts(vote, `🗳️ Vote opened by ${createdByHandle}: ${vote.title}\n${voteSummary(vote)}`);
    return json({ vote }, { status: 201 });
  } catch (cause) {
    throw error(400, cause instanceof Error ? cause.message : 'Could not create vote.');
  }
};

function inferEligibleVoters(roomIds: string[]): string[] {
  const agentHandles = new Set<string>();
  const allHandles = new Set<string>();
  for (const roomId of roomIds) {
    const room = findChatRoomById(roomId);
    for (const member of room?.members ?? []) {
      allHandles.add(member.handle);
      if (member.kind === 'agent') agentHandles.add(member.handle);
    }
  }
  return Array.from(agentHandles.size > 0 ? agentHandles : allHandles).sort();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort();
}
