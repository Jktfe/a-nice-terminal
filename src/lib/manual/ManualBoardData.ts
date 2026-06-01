// Data + layout helpers for the /manual board canvas.
// Extracted from src/routes/manual/+page.svelte (2026-05-21) to keep the
// route file under the 600-line component cap. Pure data + maths, no
// component side-effects. JWPK msg_748kn8qsjg + msg_2e53usy9yy + msg_56fssuhvi2
// established the "very detailed and real screen sized" tile shape.

export type Tile = {
  slug: string;
  title: string;
  plain: string;        // accessible-English-proof one-liner (plain-language reading level)
  route: string;        // route pattern as it lives in src/routes
  functions: string[];  // load-bearing stores / endpoints powering the screen
  cliVerbs: string[];   // matching CLI verbs (from /discover)
  x: number;            // local within cluster
  y: number;
};

export type Cluster = {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
  color: string;
  tiles: Tile[];
};

// Each tile is rendered at TILE_W × TILE_H (1280×800 — a real laptop
// viewport). At default zoom 0.18 that's 230×144 on screen — small enough
// for the whole board to fit, large enough that titles are legible.
// Operator zooms to 1.0 (100%) to read the screen content pixel-perfectly.
export const TILE_W = 1280;
export const TILE_H = 800;
export const INTRA_GAP = 80;     // gap between tiles within a cluster
export const CLUSTER_PAD = 80;   // padding inside the cluster around its tiles
export const HEADER_H = 140;     // vertical space the cluster header takes

export const CLUSTERS: Cluster[] = [
  {
    id: 'rooms',
    name: 'Rooms',
    description: 'Where people and agents talk together.',
    x: 80,
    y: 80,
    color: '#fef3c7',
    tiles: [
      { slug: 'rooms-index', title: 'Rooms index', plain: 'Every chat room you can see, in one list.',
        route: '/rooms', functions: ['listChatRooms', 'roomBookmarks store'], cliVerbs: ['ant rooms', 'ant rooms star'],
        x: 0, y: 0 },
      { slug: 'room-view', title: 'Inside a room', plain: 'Read messages, write your own, react with emoji.',
        route: '/rooms/[roomId]', functions: ['postMessage', 'fanoutMessageToRoomTerminals', 'broadcastToRoom', 'subscribeToRoomEvents'], cliVerbs: ['ant rooms post', 'ant rooms react', 'ant rooms break'],
        x: TILE_W + INTRA_GAP, y: 0 },
      { slug: 'room-participants', title: 'Who is in the room', plain: 'See every person and agent, invite more, focus an agent.',
        route: '/rooms/[roomId] · participants', functions: ['ParticipantsPanel', 'addMembership', 'enterFocus', 'AgentContextChip'], cliVerbs: ['ant rooms invite', 'ant focus enter'],
        x: 0, y: TILE_H + INTRA_GAP },
      { slug: 'vault', title: 'Vault', plain: 'Old rooms saved here so we can learn from them later.',
        route: '/vault', functions: ['listArchivedChatRooms', 'POST /api/vault/:id/mine'], cliVerbs: ['ant vault list', 'ant vault mine'],
        x: TILE_W + INTRA_GAP, y: TILE_H + INTRA_GAP }
    ]
  },
  {
    id: 'plans',
    name: 'Plans',
    description: 'Track what we are building, step by step.',
    x: 80 + 2 * (TILE_W + INTRA_GAP) + CLUSTER_PAD + 160,
    y: 80,
    color: '#dbeafe',
    tiles: [
      { slug: 'plans-index', title: 'All plans', plain: 'Every plan in one place, with how far each one has got.',
        route: '/plans', functions: ['listPlans', 'planCockpitStore'], cliVerbs: ['ant plan list'],
        x: 0, y: 0 },
      { slug: 'plan-detail', title: 'One plan', plain: 'A plan with its tasks and the proof each task is done.',
        route: '/plans/[planId]', functions: ['projectPlanEvents', 'tasksStore', 'planEvidenceStore'], cliVerbs: ['ant plan show', 'ant plan update', 'ant task create'],
        x: TILE_W + INTRA_GAP, y: 0 },
      { slug: 'plan-evidence', title: 'Plan evidence', plain: 'The links and notes that prove a plan is finished.',
        route: '/plans/evidence', functions: ['planEvidenceStore'], cliVerbs: ['ant plan evidence'],
        x: 0, y: TILE_H + INTRA_GAP }
    ]
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'What ANT remembers, ready to find again.',
    x: 80,
    y: 80 + 2 * (TILE_H + INTRA_GAP) + CLUSTER_PAD + 160,
    color: '#dcfce7',
    tiles: [
      { slug: 'memory-recall', title: 'Memory recall', plain: 'Type a word and find every message, plan and file about it.',
        route: '/memory', functions: ['recallAcrossSurfaces', 'listMessagesAfterLatestBreak'], cliVerbs: ['ant memory recall'],
        x: 0, y: 0 },
      { slug: 'search', title: 'Search', plain: 'Hunt across every room and document for what you need.',
        route: '/search', functions: ['/api/search-messages', '/api/chat-rooms/[id]/search'], cliVerbs: ['ant search'],
        x: TILE_W + INTRA_GAP, y: 0 }
    ]
  },
  {
    id: 'joining',
    name: 'Joining',
    description: 'How a new person gets into a room.',
    x: 80 + 2 * (TILE_W + INTRA_GAP) + CLUSTER_PAD + 160,
    y: 80 + 2 * (TILE_H + INTRA_GAP) + CLUSTER_PAD + 160,
    color: '#fce7f3',
    tiles: [
      { slug: 'invite-redeem', title: 'Join with a link', plain: 'A friend opens a link, types a password, and joins the room.',
        route: '/r/[inviteId]', functions: ['exchangePasswordForToken', 'createBrowserSession', 'addMembership'], cliVerbs: ['ant remote redeem'],
        x: 0, y: 0 },
      { slug: 'remote-bridge', title: 'Other ANTs', plain: 'Another ANT machine talks safely to ours.',
        route: '/remote', functions: ['/api/remote-ant/admit', '/api/remote-ant/bridge', 'remoteAdmissionStore'], cliVerbs: ['ant remote admit', 'ant remote bridge'],
        x: TILE_W + INTRA_GAP, y: 0 }
    ]
  },
  {
    id: 'terminals',
    name: 'Terminals',
    description: 'Each agent has its own terminal.',
    x: 80,
    y: 80 + 3 * (TILE_H + INTRA_GAP) + 2 * CLUSTER_PAD + 320,
    color: '#ffedd5',
    tiles: [
      { slug: 'terminals-index', title: 'All terminals', plain: 'Every agent terminal, what it is doing right now.',
        route: '/terminals', functions: ['listTerminals', 'agentStateReader'], cliVerbs: ['ant sessions list', 'ant whoami'],
        x: 0, y: 0 },
      { slug: 'terminal-detail', title: 'One terminal', plain: 'Talk to one agent or see exactly what is on its screen.',
        route: '/terminals · attached', functions: ['TerminalCard', 'POST /api/terminals/:id/input', 'POST /api/terminals/:id/kill'], cliVerbs: ['ant terminal', 'ant terminal send'],
        x: TILE_W + INTRA_GAP, y: 0 }
    ]
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Settings, dashboard, and tools for grown-ups.',
    x: 80 + 2 * (TILE_W + INTRA_GAP) + CLUSTER_PAD + 160,
    y: 80 + 3 * (TILE_H + INTRA_GAP) + 2 * CLUSTER_PAD + 320,
    color: '#ede9fe',
    tiles: [
      { slug: 'dashboard', title: 'Dashboard', plain: 'A quick look at everything important right now.',
        route: '/', functions: ['planCockpitStore', 'AgentStatusFooter', 'roomBookmarks'], cliVerbs: ['ant'],
        x: 0, y: 0 },
      { slug: 'settings', title: 'Settings', plain: 'Change how ANT works for you.',
        route: '/settings', functions: ['settingsStore', 'preferences'], cliVerbs: ['ant config'],
        x: TILE_W + INTRA_GAP, y: 0 },
      { slug: 'discover', title: 'CLI book', plain: 'Every command you can type, with examples.',
        route: '/discover', functions: ['cli-manifest', 'manifestStore'], cliVerbs: ['ant --help'],
        x: 0, y: TILE_H + INTRA_GAP },
      { slug: 'policies', title: 'Policies', plain: 'The rules ANT follows to keep things safe.',
        route: '/policies', functions: ['verificationPolicyStore', 'consentGrantStore'], cliVerbs: ['ant grant list', 'ant audit permissions'],
        x: TILE_W + INTRA_GAP, y: TILE_H + INTRA_GAP }
    ]
  }
];

// Compute the bounding box of each cluster so we can draw its background
// correctly (cluster card grows to fit its tiles).
export function clusterWidth(cluster: Cluster): number {
  const maxX = Math.max(0, ...cluster.tiles.map((t) => t.x + TILE_W));
  return maxX + CLUSTER_PAD * 2;
}

export function clusterHeight(cluster: Cluster): number {
  const maxY = Math.max(0, ...cluster.tiles.map((t) => t.y + TILE_H));
  return maxY + CLUSTER_PAD * 2 + HEADER_H;
}
