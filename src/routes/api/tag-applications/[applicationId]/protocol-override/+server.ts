/**
 * /api/tag-applications/[applicationId]/protocol-override — D4 substrate
 * (Phase A5 endpoint wrapper).
 *
 * POST — record a per-application override. Three override kinds:
 *   classification    — change protocol class for this application
 *                       (new_protocol_class REQUIRED;
 *                        e.g. demote consensus-required → heuristic)
 *   flag_ignorable    — mark application ignorable (joke, example;
 *                       verification readers skip it)
 *   withdraw          — cancel the most recent non-withdraw override
 *                       on this application
 *
 * Body: {
 *   override_kind:        'classification'|'flag_ignorable'|'withdraw',
 *   new_protocol_class?:  'deterministic'|'heuristic'|'judgement-required'|'consensus-required',
 *   handler_handle:       string,    // REQUIRED — audit-of-flagger
 *   handler_kind:         'human'|'agent'|'system',
 *   reason:               string     // REQUIRED — non-empty (audit invariant)
 * }
 *   -> 201 { override: TagApplicationOverride }
 *   -> 400 invalid body / dispute-without-reason / missing-class
 *   -> 404 application not found
 *
 * Auth: admin-bearer (substrate boundary; F1/F2 will scope to caller's
 * org/handle role).
 *
 * Surfaces: D4 iOS per-application protocol-class override (long-press
 * action sheet), M12 Mac right-click flag-with-reason.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordTagApplicationOverride } from '$lib/server/tagApplicationOverridesStore';
import type { OverrideKind } from '$lib/server/tagApplicationOverridesStore';
import type { TagActorKind, VerificationProtocolClass } from '$lib/server/verificationTaxonomyStore';

const VALID_OVERRIDE_KIND = new Set<OverrideKind>([
  'classification', 'flag_ignorable', 'withdraw'
]);
const VALID_ACTOR = new Set<TagActorKind>(['human', 'agent', 'system']);
const VALID_PROTOCOL_CLASS = new Set<VerificationProtocolClass>([
  'deterministic', 'heuristic', 'judgement-required', 'consensus-required'
]);

function requireAdminBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw error(401, 'Authorization: Bearer <admin-token> required');
  }
  const adminToken = process.env.ANT_ADMIN_TOKEN;
  if (!adminToken || auth.slice(7) !== adminToken) {
    throw error(403, 'Admin bearer required');
  }
}

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdminBearer(request);
  const applicationId = params.applicationId;
  if (!applicationId) throw error(400, 'applicationId required');

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { throw error(400, 'JSON body required'); }

  const overrideKind = body.override_kind as OverrideKind;
  const handlerHandle = body.handler_handle;
  const handlerKind = body.handler_kind as TagActorKind;
  const reason = body.reason;
  const newProtocolClass = body.new_protocol_class as VerificationProtocolClass | undefined;

  if (!VALID_OVERRIDE_KIND.has(overrideKind)) {
    throw error(400, `override_kind must be one of: ${[...VALID_OVERRIDE_KIND].join(', ')}`);
  }
  if (typeof handlerHandle !== 'string' || !handlerHandle) {
    throw error(400, 'handler_handle (string) required');
  }
  if (!VALID_ACTOR.has(handlerKind)) {
    throw error(400, `handler_kind must be one of: ${[...VALID_ACTOR].join(', ')}`);
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw error(400, 'reason (non-empty string) required — audit-of-flagger invariant');
  }
  if (newProtocolClass !== undefined && !VALID_PROTOCOL_CLASS.has(newProtocolClass)) {
    throw error(400, `new_protocol_class must be one of: ${[...VALID_PROTOCOL_CLASS].join(', ')}`);
  }

  try {
    const override = recordTagApplicationOverride({
      tagApplicationId: applicationId,
      overrideKind,
      newProtocolClass,
      handlerHandle,
      handlerKind,
      reason
    });
    return json({ override }, { status: 201 });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg.includes('does not exist')) throw error(404, msg);
    throw error(400, `recordTagApplicationOverride failed: ${msg}`);
  }
};
