import type { PageServerLoad } from './$types';
import type { FleetAgent } from '$lib/server/agentFleetStore';

export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch('/api/agents?view=fleet');
  if (!res.ok) {
    return { agents: [] as FleetAgent[], error: 'Could not load fleet data' };
  }
  const data = (await res.json()) as { agents: FleetAgent[] };
  return { agents: data.agents ?? [] };
};
