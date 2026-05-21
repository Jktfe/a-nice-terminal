/**
 * POST /api/owners/grant — create a human-consent grant.
 *
 * Verifies the owner's password + a current TOTP code, then issues a
 * grant authorising a specific target terminal to post as the owner's
 * handle for a bounded window / use-count. Recovery codes are accepted
 * via the `recoveryCode` field as an alternative to `code` if the user
 * has lost their TOTP device.
 */
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  consumeRecoveryCode,
  findOwnerByHandle,
  verifyOwnerPassword,
  verifyTotpCode
} from '$lib/server/ownersStore';
import { createHumanConsentGrant } from '$lib/server/humanConsentGrantsStore';

function parseDurationToMs(spec: string): number | null {
  const m = /^(\d+)([smhd])$/.exec(spec.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === 's') return n * 1000;
  if (unit === 'm') return n * 60_000;
  if (unit === 'h') return n * 3_600_000;
  if (unit === 'd') return n * 86_400_000;
  return null;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as {
    handle?: unknown;
    password?: unknown;
    code?: unknown;
    recoveryCode?: unknown;
    grantedToTerminalId?: unknown;
    duration?: unknown;
    maxUses?: unknown;
    createdByTerminalId?: unknown;
  };
  const handleRaw = typeof body.handle === 'string' ? body.handle.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const recoveryCode = typeof body.recoveryCode === 'string' ? body.recoveryCode.trim() : '';
  const targetTerm = typeof body.grantedToTerminalId === 'string' ? body.grantedToTerminalId.trim() : '';
  const durationSpec = typeof body.duration === 'string' ? body.duration.trim() : '';
  const maxUsesRaw = body.maxUses;
  const createdByTerm = typeof body.createdByTerminalId === 'string'
    ? body.createdByTerminalId.trim()
    : '';

  if (handleRaw.length === 0) throw error(400, 'handle required');
  if (password.length === 0) throw error(400, 'password required');
  if (code.length === 0 && recoveryCode.length === 0) throw error(400, 'code or recoveryCode required');
  if (targetTerm.length === 0) throw error(400, 'grantedToTerminalId required');
  if (createdByTerm.length === 0) throw error(400, 'createdByTerminalId required');
  if (durationSpec.length === 0) throw error(400, 'duration required (e.g. 30m, 2h, 1d)');

  const durationMs = parseDurationToMs(durationSpec);
  if (durationMs === null) throw error(400, 'duration must match <N><smhd> e.g. 30m');

  let maxUses: number | null = null;
  if (typeof maxUsesRaw === 'number' && Number.isFinite(maxUsesRaw) && maxUsesRaw > 0) {
    maxUses = Math.floor(maxUsesRaw);
  }

  const handle = handleRaw.startsWith('@') ? handleRaw : `@${handleRaw}`;
  const owner = findOwnerByHandle(handle);
  if (!owner) throw error(404, 'owner not found');
  if (!verifyOwnerPassword(owner.id, password)) throw error(401, 'password incorrect');

  if (code.length > 0) {
    if (!/^\d{6}$/.test(code)) throw error(400, 'code must be 6 digits');
    const totpResult = verifyTotpCode({ ownerId: owner.id, code });
    if (totpResult === 'not_enrolled') throw error(409, 'TOTP not enrolled — enroll-2fa first');
    if (totpResult === 'replay') throw error(400, 'code already used; wait 30s and try the next one');
    if (totpResult === 'invalid') throw error(401, 'TOTP code did not verify');
  } else {
    const ok = consumeRecoveryCode({ ownerId: owner.id, code: recoveryCode });
    if (!ok) throw error(401, 'recovery code did not verify or has been used');
  }

  const grant = createHumanConsentGrant({
    ownerId: owner.id,
    grantedToTerminalId: targetTerm,
    grantedToHandle: handle,
    createdByTerminalId: createdByTerm,
    durationMs,
    maxUses
  });

  return json({ grant }, { status: 201 });
};
