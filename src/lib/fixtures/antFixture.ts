import type { AgentCard, PreparedQuestion, RoomCard, SessionTracker } from '$lib/domain/types';

export const preparedQuestion: PreparedQuestion = {
  id: 'question-ipv6-bind',
  roomName: 'EvoluteAnt',
  agentName: 'Claude',
  question: 'How should the new room server bind during local development?',
  whyItMatters:
    'The old app hid an IPv4/IPv6 mismatch until the deck proxy failed. vNext should make this choice explicit.',
  recommendedOption: 'B',
  options: [
    {
      letter: 'A',
      title: 'Bind to loopback only',
      tradeOff: 'Safer default, weaker cross-device testing.',
      effect: 'Best for solo local work.'
    },
    {
      letter: 'B',
      title: 'Bind to a named host profile',
      tradeOff: 'A little setup, much clearer behavior.',
      effect: 'Recommended for ANT rooms across machines.'
    },
    {
      letter: 'C',
      title: 'Bind to all interfaces',
      tradeOff: 'Fast demos, higher security risk.',
      effect: 'Only for short-lived trusted networks.'
    }
  ]
};

export const roomsNeedingAttention: RoomCard[] = [
  {
    id: 'room-evolute',
    name: 'EvoluteAnt',
    summary: 'Fresh vNext scaffold needs completeness tracking.',
    attentionState: 'working',
    lastUpdate: '2 min ago'
  },
  {
    id: 'room-mockup',
    name: 'mockupANT',
    summary: 'v5 atlas closed; discussion break posted.',
    attentionState: 'ready',
    lastUpdate: '8 min ago'
  },
  {
    id: 'room-xeno',
    name: 'XenoBridge',
    summary: 'Runbook guidance captured; no active blocker.',
    attentionState: 'ready',
    lastUpdate: '22 min ago'
  }
];

export const activeAgents: AgentCard[] = [
  {
    id: 'agent-claude',
    name: 'Claude',
    role: 'logic and delivery',
    attentionState: 'working',
    agentModel: {
      modelName: 'Claude',
      costTier: 'premium'
    },
    tokenCountForThisSession: 184200
  },
  {
    id: 'agent-codex',
    name: 'Codex',
    role: 'completeness and scaffold',
    attentionState: 'working',
    agentModel: {
      modelName: 'Codex',
      costTier: 'balanced'
    },
    tokenCountForThisSession: 92100
  },
  {
    id: 'agent-kimi',
    name: 'Kimi',
    role: 'interaction audit',
    attentionState: 'ready',
    agentModel: {
      modelName: 'Kimi',
      costTier: 'cheap'
    },
    tokenCountForThisSession: 27400
  }
];

export const sessionTracker: SessionTracker = {
  id: 'session-tracker-chair',
  label: 'Session tracker',
  codename: 'Chair',
  agentModel: {
    modelName: 'session tracker',
    costTier: 'cheap'
  },
  tokenBudgetPerDay: 100000,
  watchingRoomCount: 10,
  lastSweep: '32 sec ago',
  nextSweep: '28 sec',
  escalationsWaiting: 0
};
