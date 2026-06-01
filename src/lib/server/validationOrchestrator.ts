import type { PolicyBody } from './policyStore';
import type {
  ValidationClaimPointer,
  ValidationVerifierKind
} from './validationScoring';

export type ValidationTransportHint =
  | 'heads_down'
  | 'interview'
  | 'artefact_check'
  | 'context_summary';

export type ValidationParticipant = {
  kind: ValidationVerifierKind;
  handle: string;
};

export type ValidationAssignment = {
  verifierKind: ValidationVerifierKind;
  handle: string;
  transport: ValidationTransportHint;
  reason: string;
};

export type ValidationMissingSlot = {
  verifierKind: ValidationVerifierKind;
  count: number;
  reason: string;
};

export type ValidationClaimRoutePlan = {
  claim: ValidationClaimPointer;
  assignments: ValidationAssignment[];
  missing: ValidationMissingSlot[];
};

export type ValidationOrchestrationPlan = {
  claimPlans: ValidationClaimRoutePlan[];
  summary: {
    totalClaims: number;
    readyClaims: number;
    blockedClaims: number;
    assignments: number;
    missingSlots: number;
  };
};

type Requirement = {
  agents?: number;
  humans?: number;
  AND_humans?: number;
  OR_humans?: number;
  OR_agentsPlusFile?: number[];
  OR_agentsPlusContextSummary_humans?: number[];
};

type RouteSlot = {
  kind: ValidationVerifierKind;
  count: number;
  reason: string;
};

type RouteOption = {
  slots: RouteSlot[];
  primary: boolean;
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function numberList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
  return numbers.length === value.length ? numbers : undefined;
}

function requirementFrom(value: unknown): Requirement {
  const record = objectRecord(value);
  if (!record) return {};
  return {
    agents: positiveNumber(record.agents),
    humans: positiveNumber(record.humans),
    AND_humans: positiveNumber(record.AND_humans),
    OR_humans: positiveNumber(record.OR_humans),
    OR_agentsPlusFile: numberList(record.OR_agentsPlusFile),
    OR_agentsPlusContextSummary_humans: numberList(record.OR_agentsPlusContextSummary_humans)
  };
}

function requirementFor(policy: PolicyBody, kind: string): Requirement {
  const blocks = objectRecord(policy.blocks);
  if (blocks?.[kind]) return requirementFrom(blocks[kind]);
  return requirementFrom(policy.fallback);
}

function slot(kind: ValidationVerifierKind, count: number | undefined, reason: string): RouteSlot[] {
  if (count === undefined || count <= 0) return [];
  return [{ kind, count, reason }];
}

function routeOptionsFor(requirement: Requirement): RouteOption[] {
  const primarySlots = [
    ...slot('agent', requirement.agents, `${requirement.agents ?? 0} agents`),
    ...slot('human', requirement.humans, `${requirement.humans ?? 0} humans`)
  ];

  if (requirement.AND_humans !== undefined) {
    return [{
      primary: true,
      slots: [
        ...slot('agent', requirement.agents, `${requirement.agents ?? 0} agents`),
        ...slot('human', requirement.AND_humans, `AND ${requirement.AND_humans} humans`)
      ]
    }];
  }

  if (requirement.OR_humans !== undefined) {
    return [
      { primary: true, slots: primarySlots },
      { primary: false, slots: slot('human', requirement.OR_humans, `OR ${requirement.OR_humans} humans`) }
    ];
  }

  if (requirement.OR_agentsPlusFile !== undefined) {
    const alt = requirement.OR_agentsPlusFile;
    return [
      { primary: true, slots: primarySlots },
      {
        primary: false,
        slots: [
          ...slot('agent', alt[0], `OR ${alt[0] ?? 0} agents + ${alt[1] ?? 0} file`),
          ...slot('file', alt[1], `OR ${alt[0] ?? 0} agents + ${alt[1] ?? 0} file`)
        ]
      }
    ];
  }

  if (requirement.OR_agentsPlusContextSummary_humans !== undefined) {
    const alt = requirement.OR_agentsPlusContextSummary_humans;
    return [
      { primary: true, slots: primarySlots },
      {
        primary: false,
        slots: [
          ...slot('agent', alt[0], `OR ${alt[0] ?? 0} agents + ${alt[1] ?? 0} context summaries + ${alt[2] ?? 0} humans`),
          ...slot('context_summary', alt[1], `OR ${alt[0] ?? 0} agents + ${alt[1] ?? 0} context summaries + ${alt[2] ?? 0} humans`),
          ...slot('human', alt[2], `OR ${alt[0] ?? 0} agents + ${alt[1] ?? 0} context summaries + ${alt[2] ?? 0} humans`)
        ]
      }
    ];
  }

  return [{ primary: true, slots: primarySlots }];
}

function transportFor(kind: ValidationVerifierKind): ValidationTransportHint {
  if (kind === 'agent') return 'heads_down';
  if (kind === 'human') return 'interview';
  if (kind === 'file') return 'artefact_check';
  return 'context_summary';
}

function countAvailable(participants: ValidationParticipant[], kind: ValidationVerifierKind): number {
  return participants.filter((participant) => participant.kind === kind).length;
}

function optionIsReady(option: RouteOption, participants: ValidationParticipant[]): boolean {
  return option.slots.every((candidate) => countAvailable(participants, candidate.kind) >= candidate.count);
}

function chooseOption(options: RouteOption[], participants: ValidationParticipant[]): RouteOption {
  const ready = options.find((option) => optionIsReady(option, participants));
  if (ready) return ready;
  return options.find((option) => option.primary) ?? options[0] ?? { primary: true, slots: [] };
}

function planClaim(
  claim: ValidationClaimPointer,
  option: RouteOption,
  participants: ValidationParticipant[]
): ValidationClaimRoutePlan {
  const assignments: ValidationAssignment[] = [];
  const missing: ValidationMissingSlot[] = [];

  for (const wanted of option.slots) {
    const candidates = participants.filter((participant) => participant.kind === wanted.kind);
    for (const participant of candidates.slice(0, wanted.count)) {
      assignments.push({
        verifierKind: wanted.kind,
        handle: participant.handle,
        transport: transportFor(wanted.kind),
        reason: wanted.reason
      });
    }
    const missingCount = wanted.count - Math.min(wanted.count, candidates.length);
    if (missingCount > 0) {
      missing.push({
        verifierKind: wanted.kind,
        count: missingCount,
        reason: wanted.reason
      });
    }
  }

  return { claim, assignments, missing };
}

export function planValidationOrchestration(input: {
  policy: PolicyBody;
  claims: ValidationClaimPointer[];
  participants: ValidationParticipant[];
}): ValidationOrchestrationPlan {
  const claimPlans = input.claims.map((claim) => {
    const requirement = requirementFor(input.policy, claim.kind);
    const option = chooseOption(routeOptionsFor(requirement), input.participants);
    return planClaim(claim, option, input.participants);
  });

  const readyClaims = claimPlans.filter((plan) => plan.missing.length === 0).length;
  const assignments = claimPlans.reduce((total, plan) => total + plan.assignments.length, 0);
  const missingSlots = claimPlans.reduce(
    (total, plan) => total + plan.missing.reduce((inner, slot) => inner + slot.count, 0),
    0
  );

  return {
    claimPlans,
    summary: {
      totalClaims: claimPlans.length,
      readyClaims,
      blockedClaims: claimPlans.length - readyClaims,
      assignments,
      missingSlots
    }
  };
}
