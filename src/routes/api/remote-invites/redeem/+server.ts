/**
 * POST /api/remote-invites/redeem — Mac antchat shim for redeeming an
 * `antchat://invite?admission_id=...&token=...` deep link.
 *
 * Wraps `remoteRedeem.redeemAdmissionAndMintMapping` (the same atomic
 * redeem-and-mint helper the canonical `/api/remote-ant/admissions/:id/redeem`
 * route uses). The redeeming user is required to be signed in to the Mac
 * antchat app — their Bearer handle becomes the synthetic mapping's
 * `remote_instance_label` so the room operator sees who joined.
 *
 * Auth: Mac antchat Bearer token (issued by /api/auth/login). 401 if
 * missing/unresolved. The code+admission_id pair is still the admission
 * gate; Bearer auth only identifies WHO is redeeming so the resulting
 * mapping/membership is attributable.
 *
 * Request body (either shape accepted so the Mac app can hand the raw
 * deep-link URL to the server OR parse it client-side):
 *   { invite_url: string }
 *     where invite_url = 'antchat://invite?admission_id=...&token=...'
 *   OR
 *   { admission_id: string, token: string, label?: string, direction?: 'in'|'out'|'both' }
 *
 * Response (200):
 *   {
 *     mapping: { id, room_id, remote_instance_label, direction,
 *                lifetime_preset, expires_at_ms },
 *     bridge_token: string,        // plaintext rbt_... returned ONCE
 *     room_id: string              // convenience for Mac app navigation
 *   }
 *
 * Errors:
 *   400 missing/malformed body, bad direction enum, malformed invite_url
 *   401 missing/invalid antchat Bearer
 *   410 admission not found / revoked / expired / already redeemed / wrong code
 *
 * Note on 200 vs 201: per the directive's acceptance gate 2 ("redeem POST → 200"),
 * the Mac app expects 200 here even though the canonical remote-ant redeem
 * returns 201. The wrapped store call is identical.
 *
 * Source directive: @evolveantswift msg_57o7qyc54b (D2 remote-invite shim).
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  bearerTokenFromHeader,
  resolveToken,
  userShapeForEmail
} from '$lib/server/antchatAuthStore';
import { redeemAdmissionAndMintMapping } from '$lib/server/remoteRedeem';
import type { MappingDirection } from '$lib/server/remoteMappingStore';

const ALLOWED_DIRECTIONS: readonly MappingDirection[] = ['in', 'out', 'both'];

function isAllowedDirection(value: unknown): value is MappingDirection {
  return typeof value === 'string' && (ALLOWED_DIRECTIONS as readonly string[]).includes(value);
}

type ParsedInvite = { admissionId: string; token: string };

function parseInviteUrl(raw: string): ParsedInvite | null {
  // Accept either antchat://invite?... or https://.../r/invite?... style.
  // URL parsing is permissive — we only need the two query params.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const admissionId = url.searchParams.get('admission_id') ?? url.searchParams.get('admissionId');
  const token = url.searchParams.get('token') ?? url.searchParams.get('code');
  if (!admissionId || !token) return null;
  return { admissionId, token };
}

// Derive a stable, URL-safe label from the redeemer's handle for the
// synthetic mapping (e.g. '@j.stephenson' → 'j.stephenson'). The handle
// already carries identity; the label is only the human-readable column
// the operator sees in the mappings list.
function labelFromHandle(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 120) || 'redeemer';
}

export const POST: RequestHandler = async ({ request }) => {
  const bearer = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!bearer) throw error(401, 'bearer token required');
  const session = resolveToken(bearer);
  if (!session) throw error(401, 'invalid or expired token');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');

  const raw = body as Record<string, unknown>;
  let admissionId: string | undefined;
  let token: string | undefined;

  const inviteUrlRaw = raw.invite_url ?? raw.inviteUrl;
  if (typeof inviteUrlRaw === 'string' && inviteUrlRaw.length > 0) {
    const parsed = parseInviteUrl(inviteUrlRaw);
    if (!parsed) throw error(400, 'invite_url malformed (need admission_id + token query params)');
    admissionId = parsed.admissionId;
    token = parsed.token;
  } else {
    const admIdRaw = raw.admission_id ?? raw.admissionId;
    const tokenRaw = raw.token ?? raw.code;
    if (typeof admIdRaw !== 'string' || admIdRaw.length === 0) {
      throw error(400, 'admission_id (or invite_url) required');
    }
    if (typeof tokenRaw !== 'string' || tokenRaw.length === 0) {
      throw error(400, 'token (or invite_url) required');
    }
    admissionId = admIdRaw;
    token = tokenRaw;
  }

  const directionRaw = raw.direction;
  let direction: MappingDirection | undefined;
  if (directionRaw !== undefined) {
    if (!isAllowedDirection(directionRaw)) throw error(400, 'direction must be in|out|both');
    direction = directionRaw;
  }

  const labelRaw = raw.label;
  const inviterHandle = userShapeForEmail(session.email).handle;
  const remoteInstanceLabel =
    typeof labelRaw === 'string' && labelRaw.trim().length > 0
      ? labelRaw.trim().slice(0, 120)
      : labelFromHandle(inviterHandle);

  const result = redeemAdmissionAndMintMapping({
    admissionId,
    code: token,
    remoteInstanceLabel,
    direction
  });
  if (!result) throw error(410, 'admission not found, revoked, expired, or already redeemed');

  return json({
    mapping: {
      id: result.mapping.id,
      room_id: result.mapping.room_id,
      remote_instance_label: result.mapping.remote_instance_label,
      direction: result.mapping.direction,
      lifetime_preset: result.mapping.lifetime_preset,
      expires_at_ms: result.mapping.expires_at_ms
    },
    bridge_token: result.bridgeToken,
    room_id: result.mapping.room_id
  });
};
