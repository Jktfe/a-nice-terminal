import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * /dash -> /.
 *
 * Short alias for the dashboard route. Keep this route server-side so cold
 * opens, context-menu new tabs, and copied URLs all land on the same surface.
 */
export const load: PageServerLoad = async () => {
  throw redirect(307, '/');
};
