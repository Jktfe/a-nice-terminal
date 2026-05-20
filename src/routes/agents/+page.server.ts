import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch('/api/agents?view=fleet');
  if (!res.ok) {
    return { agents: [], error: 'Could not load fleet data' };
  }
  const data = await res.json();
  return { agents: data.agents ?? [] };
};
