import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { doesChatRoomExist, findChatRoomById, isHandleMemberOfRoom } from '$lib/server/chatRoomStore';
import { resolveCallerIdentityStrict } from '$lib/server/authGate';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
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

export const GET: RequestHandler = async ({ url, request }) => {
  const roomId = url.searchParams.get('roomId');
  if (!roomId) throw error(400, 'roomId query parameter is required.');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found.');
  // Read-auth: only members (or admin) may list a room's votes.
  await requireChatRoomReadAccess(request, room);
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
  // The strict resolver only authorizes the creator against the PRIMARY
  // room. Binding a vote into additional rooms grants those rooms reach into
  // the vote (receipts, cast scope), so the creator must also be a member of
  // every OTHER bound room — never bind a room the creator isn't in.
  for (const roomId of boundRooms) {
    if (roomId === primaryRoomId) continue;
    if (!isHandleMemberOfRoom(roomId, createdByHandle)) {
      throw error(403, `${createdByHandle} is not a member of bound room ${roomId}.`);
    }
  }
  const title = requiredString(body.title, 'title');
  // `statesOrdered` (status boards) preserves column order as given;
  // `options` (votes) goes through readStringList which sorts. A status
  // board's progression order is meaningful, so it must not be alphabetised.
  const options = Array.isArray(body.statesOrdered)
    ? orderedUnique(body.statesOrdered)
    : readStringList(body.options);
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
    // The trailing fence makes the receipt render as a live inline widget in
    // every bound room. `boardKind:'status'` (the /status-poll milestone
    // tracker, JWPK msg_39mnm7blal) emits an ant-status fence → StatusBoard;
    // otherwise an ant-poll fence → PollWidget (JWPK msg_7nqg8oaufo). The
    // text summary above it is the CLI/non-rendering fallback either way. The
    // board reuses the vote primitive — same store, different fence.
    const isStatusBoard = body.boardKind === 'status';
    const receipt = isStatusBoard
      ? `📍 Status board opened by ${createdByHandle}: ${vote.title}\n${voteSummary(vote)}\n\n\`\`\`ant-status\n${vote.id}\n\`\`\``
      : `🗳️ Vote opened by ${createdByHandle}: ${vote.title}\n${voteSummary(vote)}\n\n\`\`\`ant-poll\n${vote.id}\n\`\`\``;
    postVoteReceipts(vote, receipt);
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

/** Dedupe + trim, PRESERVING order (no sort). For status-board state columns. */
function orderedUnique(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
