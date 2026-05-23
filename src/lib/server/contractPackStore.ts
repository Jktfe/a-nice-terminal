export type ContractAccess = 'public' | 'premium';

export type ContractStub = {
  id: string;
  version: string;
  title: string;
  featureKey: string;
  access: ContractAccess;
  status: 'active' | 'draft' | 'planned';
  summary: string;
  bodyAvailable: boolean;
  bodyLocation: 'oss-repo' | 'premium-app-bundle';
  requiresFeatures: string[];
};

type ContractDefinition = ContractStub & {
  publicBody?: string;
};

export type ContractPackSummary = {
  id: string;
  version: string;
  publicSurface: 'stubs-only';
  bodyPolicy: 'premium-bodies-not-served-from-oss';
};

export type ContractDetail = {
  contract: ContractStub;
  body: string | null;
  bodyAccess: 'public' | 'locked';
  lockedReason: string | null;
};

export const CONTRACT_PACK: ContractPackSummary = {
  id: 'ant-contract-pack',
  version: 'v1',
  publicSurface: 'stubs-only',
  bodyPolicy: 'premium-bodies-not-served-from-oss'
};

const CONTRACTS: ContractDefinition[] = [
  {
    id: 'agent-onboarding-v1',
    version: '1.0.0',
    title: 'Agent onboarding',
    featureKey: 'agent-onboarding',
    access: 'public',
    status: 'active',
    summary: 'Public operating grammar for joining an ANT room and using the CLI safely.',
    bodyAvailable: true,
    bodyLocation: 'oss-repo',
    requiresFeatures: ['rooms', 'tasks', 'memory'],
    publicBody: [
      '# Agent onboarding',
      '',
      'Use the ANT CLI as the operating surface.',
      'Read room state before posting.',
      'Claim work before editing files.',
      'Use plans, tasks, memories, artefacts, and asks as shared context.',
      'Verify before claiming a slice is shipped.'
    ].join('\n')
  },
  {
    id: 'room-memory-v1',
    version: '1.0.0',
    title: 'Room memory',
    featureKey: 'memory',
    access: 'public',
    status: 'active',
    summary: 'Public contract for small room-linked Markdown memories.',
    bodyAvailable: true,
    bodyLocation: 'oss-repo',
    requiresFeatures: ['memory'],
    publicBody: [
      '# Room memory',
      '',
      'Store durable room facts as small Markdown files.',
      'Link memories to rooms by id.',
      'Recall memories through ANT instead of copying private vault paths into chat.'
    ].join('\n')
  },
  {
    id: 'speed-matters-governance-v1',
    version: '1.0.0',
    title: 'Speed Matters governance',
    featureKey: 'governance',
    access: 'public',
    status: 'active',
    summary: 'Public room-governance grammar: support, challenge, alternative, hold, abstain.',
    bodyAvailable: true,
    bodyLocation: 'oss-repo',
    requiresFeatures: ['rooms', 'tasks'],
    publicBody: [
      '# Speed Matters governance',
      '',
      'Consequential decisions need evidence.',
      'Agents should support, challenge, offer an alternative, hold with a reason, or abstain.',
      'Consensus without evidence is not governance.'
    ].join('\n')
  },
  {
    id: 'chair-v1',
    version: '1.0.0',
    title: 'Chair',
    featureKey: 'chair',
    access: 'premium',
    status: 'planned',
    summary: 'Premium coordinator contract for room summaries, handoff, escalation, and away-mode flow.',
    bodyAvailable: false,
    bodyLocation: 'premium-app-bundle',
    requiresFeatures: ['chair_ux']
  },
  {
    id: 'validation-lenses-v1',
    version: '1.0.0',
    title: 'Validation lenses',
    featureKey: 'validation',
    access: 'premium',
    status: 'active',
    summary: 'Premium contract for applying user-selected validation schemas as inspectable lenses.',
    bodyAvailable: false,
    bodyLocation: 'premium-app-bundle',
    requiresFeatures: ['verification_ux']
  },
  {
    id: 'stage-live-alternatives-v1',
    version: '1.0.0',
    title: 'Stage live alternatives',
    featureKey: 'stage',
    access: 'premium',
    status: 'active',
    summary: 'Premium contract for feedback-anchored alternative generation during presentations.',
    bodyAvailable: false,
    bodyLocation: 'premium-app-bundle',
    requiresFeatures: ['decks', 'verification_ux']
  }
];

export function listContractStubs(): ContractStub[] {
  return CONTRACTS.map(toStub);
}

export function getContractDetail(contractId: string): ContractDetail | null {
  const contract = CONTRACTS.find((entry) => entry.id === contractId);
  if (!contract) return null;

  const stub = toStub(contract);
  if (contract.access === 'public') {
    return {
      contract: stub,
      body: contract.publicBody ?? '',
      bodyAccess: 'public',
      lockedReason: null
    };
  }

  return {
    contract: stub,
    body: null,
    bodyAccess: 'locked',
    lockedReason: 'Full contract body is bundled only with the licensed premium app.'
  };
}

function toStub(contract: ContractDefinition): ContractStub {
  return {
    id: contract.id,
    version: contract.version,
    title: contract.title,
    featureKey: contract.featureKey,
    access: contract.access,
    status: contract.status,
    summary: contract.summary,
    bodyAvailable: contract.bodyAvailable,
    bodyLocation: contract.bodyLocation,
    requiresFeatures: [...contract.requiresFeatures]
  };
}
