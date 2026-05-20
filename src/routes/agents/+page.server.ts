import type { PageServerLoad } from './$types';

// /api/agents returns the bare registry shape (handle / displayName / rooms);
// the fleet page expects a richer object (stats, sparkline, heatmap, status,
// etc.). Until a real view=fleet aggregator is built we normalise here with
// safe zero defaults so the page renders without crashing on undefined reads.
export type FleetAgent = {
  handle: string;
  displayName: string | null;
  displayColor: string | null;
  displayIcon: string | null;
  displayBackgroundStyle: string | null;
  rooms: Array<{ roomId: string; roomName: string; joinedAt: string }>;
  status: { state: string | null; atMs: number | null } | null;
  productivityScore: number;
  deliveryRate: number;
  streakDays: number;
  workspace: string | null;
  sparkline: number[];
  heatmap: number[];
  pastRooms: Array<{ roomId: string; roomName: string }>;
  collaborators: string[];
  stats: {
    messages24h: number;
    runEvents24h: number;
    plansCreated: number;
    positiveReactions: number;
    tasks: { completed: number; inProgress: number; pending: number; blocked: number };
    asksPosed: { open: number };
  };
};

function normaliseAgent(a: any): FleetAgent {
  return {
    handle: a.handle,
    displayName: a.displayName ?? null,
    displayColor: a.displayColor ?? null,
    displayIcon: a.displayIcon ?? null,
    displayBackgroundStyle: a.displayBackgroundStyle ?? null,
    rooms: a.rooms ?? [],
    status: null,
    productivityScore: 0,
    deliveryRate: 0,
    streakDays: 0,
    workspace: null,
    sparkline: [],
    heatmap: [0, 0, 0, 0, 0, 0, 0],
    pastRooms: [],
    collaborators: [],
    stats: {
      messages24h: 0,
      runEvents24h: 0,
      plansCreated: 0,
      positiveReactions: 0,
      tasks: { completed: 0, inProgress: 0, pending: 0, blocked: 0 },
      asksPosed: { open: 0 },
    },
  };
}

export const load: PageServerLoad = async ({ fetch }) => {
  const res = await fetch('/api/agents?view=fleet');
  if (!res.ok) {
    return { agents: [] as FleetAgent[], error: 'Could not load fleet data' };
  }
  const data = await res.json();
  const agents: FleetAgent[] = (data.agents ?? []).map(normaliseAgent);
  return { agents };
};
