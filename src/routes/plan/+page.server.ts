import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /plan → /plans 307 redirect.
 *
 * The route formerly rendered the hand-curated Programme board snapshot
 * (src/lib/server/programmeBoardData.ts, synced with docs/PROGRAMME.md).
 * That snapshot froze on 2026-05-12 and the team has since shipped v4-up
 * via the canonical-gated task model in /plans (Lane-D), which is the
 * live source of truth for plan status. The Programme baseline doc lives
 * on at docs/PROGRAMME.md for reference; this route now sends visitors
 * to the live view.
 *
 * Server-side 307 (temporary): preserves the request method, leaves the
 * door open to repurpose /plan as a different surface later without a
 * permanent-redirect cache trap.
 */
export const load: PageServerLoad = async () => {
  throw redirect(307, '/plans');
};
