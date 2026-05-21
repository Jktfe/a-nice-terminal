/**
 * POST /api/license/validate
 *
 * Validate a Mac antchat licence code (`NEW-MODEL-ANT-DEV-<email>`) against
 * the dev-licences allowlist at ~/.ant/dev-licences.json.
 *
 * Request body: { licenseKey: 'NEW-MODEL-ANT-DEV-<email>' }
 * Response (200): LicenceValidationResponse — `valid`, `tier: 'free'|'paid'`,
 *                 `features`, `expiresAt`, `stripeCustomerId`, `upgradeUrl`.
 *
 * Server-side tier 'dev' maps to client-side 'paid' (full features). The
 * Swift LicenceTier enum only ships 'free' | 'paid'; dev-tier team users
 * get paid-equivalent UX without any billing path.
 *
 * Spec: ObsidiANT/contracts/antchat-api-2026-05-19.md §2.
 * Authority: JWPK msg_m23v9tltxi.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseAndValidateLicenceKey, licenceShapeForEmail } from '$lib/server/antchatAuthStore';

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }
  if (!body || typeof body !== 'object') throw error(400, 'body required');

  const licenseKey = (body as Record<string, unknown>).licenseKey;
  if (typeof licenseKey !== 'string' || licenseKey.trim().length === 0) {
    throw error(400, 'licenseKey required');
  }

  const email = parseAndValidateLicenceKey(licenseKey);
  if (!email) {
    // Return a not-valid response (200) rather than 4xx so client can
    // handle the UX gracefully without treating it as a hard error.
    return json({
      valid: false,
      tier: 'free',
      expiresAt: null,
      features: [],
      stripeCustomerId: null,
      upgradeUrl: null
    });
  }

  return json(licenceShapeForEmail(email));
};
