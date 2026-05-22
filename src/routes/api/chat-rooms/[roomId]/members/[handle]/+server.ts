import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  findChatRoomById,
  updateRoomMemberPresentation,
  type ParticipantBackgroundStyle
} from '$lib/server/chatRoomStore';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function decodeHandleParam(rawHandle: string): string {
  const decoded = decodeURIComponent(rawHandle);
  return decoded.startsWith('@') ? decoded : `@${decoded}`;
}

function assertRoomExists(roomId: string): void {
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
}

function parseShortIcon(rawIcon: unknown): string | undefined {
  if (rawIcon === undefined) return undefined;
  if (typeof rawIcon !== 'string') throw error(400, 'displayIcon must be a string.');
  const trimmed = rawIcon.trim();
  if (trimmed.length === 0) return undefined;
  // Custom-logo escape hatch: `logo:<filename.svg>` references an
  // asset in /static/llm-icons/ via the catalogue in
  // lib/icons/llmLogoCatalogue.ts. We don't import the catalogue at
  // the route layer to keep this stateless — instead we accept any
  // filename-shaped slug and let the MemberIcon renderer fall back
  // gracefully if the file isn't there.
  if (trimmed.startsWith('logo:')) {
    if (trimmed.length > 80) {
      throw error(400, 'logo: displayIcon must be 80 characters or fewer.');
    }
    const slug = trimmed.slice('logo:'.length);
    if (!/^[A-Za-z0-9._()-]+\.(?:svg|png|webp)$/.test(slug)) {
      throw error(400, 'logo: displayIcon must reference a .svg/.png/.webp file.');
    }
    return trimmed;
  }
  if (Array.from(trimmed).length > 4 || trimmed.length > 16) {
    throw error(400, 'displayIcon must be an emoji or short label.');
  }
  return trimmed;
}

function parseBackgroundStyle(rawStyle: unknown): ParticipantBackgroundStyle | undefined {
  if (rawStyle === undefined) return undefined;
  if (typeof rawStyle !== 'string') throw error(400, 'displayBackgroundStyle must be a string.');
  const trimmed = rawStyle.trim();
  if (trimmed === 'card' || trimmed === 'tint' || trimmed === 'transparent') return trimmed;
  throw error(400, 'displayBackgroundStyle must be card, tint, or transparent.');
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  assertRoomExists(params.roomId);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'Send a JSON object.');
  }
  // Identity gate stays — caller must still be authenticated for THIS room.
  // PID-as-identity model JWPK 2026-05-21 + 2026-05-22 (msg_uof0d8oafe):
  // presentation (displayName / displayColor / displayIcon / background
  // style) is cosmetic, not identity. The immutable handle / PID are
  // load-bearing; display fields can be edited by any room member without
  // a spoofing path opening up. Same reframe we applied to room aliases
  // when we dropped the equivalent CVE-FIX-D guard there.
  requireChatRoomMutationAuth(params.roomId, request, body);
  const targetHandle = decodeHandleParam(params.handle);

  const displayNameRaw = (body as { displayName?: unknown }).displayName;
  const displayColorRaw = (body as { displayColor?: unknown }).displayColor;
  const displayIcon = parseShortIcon((body as { displayIcon?: unknown }).displayIcon);
  const displayBackgroundStyle = parseBackgroundStyle(
    (body as { displayBackgroundStyle?: unknown }).displayBackgroundStyle
  );

  let displayName: string | undefined;
  if (displayNameRaw !== undefined) {
    if (typeof displayNameRaw !== 'string') throw error(400, 'displayName must be a string.');
    const trimmed = displayNameRaw.trim();
    if (trimmed.length === 0) throw error(400, 'displayName cannot be blank.');
    if (trimmed.length > 48) throw error(400, 'displayName must be 48 characters or fewer.');
    displayName = trimmed;
  }

  let displayColor: string | undefined;
  if (displayColorRaw !== undefined) {
    if (typeof displayColorRaw !== 'string') throw error(400, 'displayColor must be a string.');
    const trimmed = displayColorRaw.trim();
    if (!HEX_COLOR_RE.test(trimmed)) throw error(400, 'displayColor must be a #RRGGBB hex colour.');
    displayColor = trimmed.toUpperCase();
  }

  try {
    const member = updateRoomMemberPresentation({
      roomId: params.roomId,
      globalHandle: decodeHandleParam(params.handle),
      displayName,
      displayColor,
      displayIcon,
      displayBackgroundStyle
    });
    return json({ member });
  } catch (causeOfFailure) {
    const message =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not update participant.';
    throw error(message.includes('not a member') ? 404 : 400, message);
  }
};
