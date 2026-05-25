/**
 * Static explain map for click-to-explain v0 (OSS).
 * Keys are CSS selectors or component-scoped IDs.
 * Premium slice can replace this with a dynamic fetch.
 */

export type Explanation = {
  what: string;
  why: string;
  docsPath?: string;
};

export const EXPLAIN_MAP: Record<string, Explanation> = {
  // ── Rooms ──
  'rooms-filter': {
    what: 'Filter rooms by name or description.',
    why: 'When you have many rooms, typing a few characters finds the one you need without scrolling.',
  },
  'rooms-create': {
    what: 'Create a new chat room.',
    why: 'Rooms are where agents and humans coordinate work. Every project or topic gets its own room.',
    docsPath: '/docs/rooms',
  },
  'rooms-starred': {
    what: 'Starred rooms appear at the top of your dashboard.',
    why: 'Pin the rooms you visit most so they are always one click away.',
  },
  'room-mode': {
    what: 'Room mode controls how agents behave.',
    why: 'Brainstorm = open chat; heads-down = focused delivery; closed = pause all work.',
  },
  'room-away': {
    what: 'Your away-mode tier.',
    why: 'Tells agents how intensively to work while you are away — active, away-from-desk, or away-from-office.',
  },
  'room-chat-composer': {
    what: 'Type a message and send it to the room.',
    why: 'The primary way you talk to agents and other humans in this room.',
  },
  'room-message-list': {
    what: 'All messages in this room, newest first.',
    why: 'Scroll back to see what was said, what decisions were made, and what agents committed to.',
  },
  'room-participants': {
    what: 'Everyone in this room: humans and agents.',
    why: 'See who is present, who is focused, and invite new participants.',
  },

  // ── Plans ──
  'plans-donut': {
    what: 'A completion ring showing done vs total tasks.',
    why: 'At a glance you see how much of a plan is finished — green is done, grey is remaining.',
  },
  'plans-overall': {
    what: 'Aggregate completion across every active plan.',
    why: 'See the big picture: how much of ALL your plans is done, not just one.',
  },
  'plans-filter': {
    what: 'Filter plans by title.',
    why: 'When you have many plans, quickly find the one you want to drill into.',
  },
  'plans-insights': {
    what: 'Analytics and trends across your plans.',
    why: 'Understand velocity, blockers, and completion patterns over time.',
  },
  'plans-evidence': {
    what: 'Proof and artefacts attached to plan tasks.',
    why: 'Audit trail showing what was done, by whom, and when.',
  },

  // ── Asks ──
  'asks-queue': {
    what: 'Open questions that need a human decision.',
    why: 'Agents raise asks when they are blocked or need policy clarity. Answering them unblocks delivery.',
  },
  'asks-answer': {
    what: 'Answer or dismiss an ask.',
    why: 'Your answer becomes a durable decision record. Dismissal removes noise when the ask is no longer relevant.',
  },
  'asks-filter': {
    what: 'Filter asks by title or room.',
    why: 'Find the specific ask you need to answer across many rooms.',
  },

  // ── Decks / Stage ──
  'deck-voice': {
    what: 'Start or pause slide narration.',
    why: 'Stage decks can be narrated so you listen while reviewing; pause to anchor feedback to a moment.',
  },
  'deck-validation': {
    what: 'Toggle claim validation overlay.',
    why: 'See which claims on a slide are verified and which need evidence — switch lenses for different audiences.',
  },
  'deck-share': {
    what: 'Copy a shareable link to this deck.',
    why: 'Let others view the presentation without needing to navigate to it.',
  },
  'deck-feedback': {
    what: 'Submit feedback on a slide during a presentation.',
    why: 'Your feedback creates alternative artefacts and proposal tracks for the presenter to review.',
  },

  // ── Agents ──
  'agents-activity-strip': {
    what: 'Real-time activity chips for your top agents.',
    why: 'See who is working right now, how many messages they sent, and their current status at a glance.',
  },
  'agents-fleet-stats': {
    what: 'Aggregate fleet telemetry.',
    why: 'Active count, total registered, and rooms occupied give you the big picture of your agent workforce.',
  },
  'agents-card': {
    what: 'An individual agent card with productivity, sparkline, and timeline.',
    why: 'Click to expand and see detailed activity history, missed messages, and delivery rate for that agent.',
  },

  // ── Settings ──
  'settings-theme': {
    what: 'Toggle between light and dark mode.',
    why: 'Pick the theme that is easiest on your eyes for the current lighting.',
  },
  'settings-identity': {
    what: 'Your identity and authentication settings.',
    why: 'Manage how the system knows who you are and what you can access.',
  },

  // ── Search ──
  'search-input': {
    what: 'Search across rooms, messages, tasks, and artefacts.',
    why: 'Find anything you have said or created without remembering which room it was in.',
  },

  // ── Discover ──
  'discover-visuals': {
    what: 'Browse visual assets and components.',
    why: 'Reuse existing designs, colours, and components instead of creating from scratch.',
  },

  // ── Diagnostics ──
  'diagnostics-health': {
    what: 'System health and status checks.',
    why: 'See if the server, database, and integrations are healthy before trusting the UI.',
  },

  // ── Vault ──
  'vault-files': {
    what: 'Browse files in your Obsidian vault.',
    why: 'Access research notes, contracts, and long-form documents stored as markdown.',
  },

  // ── Memory ──
  'memory-recall': {
    what: 'Recall relevant memories for the current context.',
    why: 'Agents use memories to stay consistent across sessions without re-learning everything.',
  },

  // ── Safety / Archive ──
  'safety-recovery': {
    what: 'Recover archived or deleted rooms and plans.',
    why: 'Mistakes happen; soft-delete means you can restore accidentally removed work.',
  },

  // ── Chair ──
  'chair-dashboard': {
    what: 'Chair operating dashboard for room coordination.',
    why: 'See open asks, active claims, and delivery pressure across all rooms you chair.',
  },

  // ── Ledger ──
  'ledger-capabilities': {
    what: 'Capability ledger — what is shipped, what is in flight, what is deferred.',
    why: 'The canonical record of product decisions so nothing is lost or silently dropped.',
  },
};

export function lookupExplanation(key: string): Explanation | undefined {
  return EXPLAIN_MAP[key];
}
