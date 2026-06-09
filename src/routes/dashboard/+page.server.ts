import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /dashboard -> /.
 *
 * The dashboard lives at the root route, but users and stale client bundles
 * can still open the old dashboard name directly in a fresh tab.
 */
export const load: PageServerLoad = async () => {
  throw redirect(307, '/');
};
