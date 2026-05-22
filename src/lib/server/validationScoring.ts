import type { PolicyBody } from './policyStore';

export type ValidationVerifierKind = 'agent' | 'human' | 'file' | 'context_summary';
export type ValidationOutcome = 'pass' | 'fail' | 'needs_context';

export type ValidationClaimCheck = {
  verifierKind: ValidationVerifierKind;
  outcome: ValidationOutcome;
};

export type ValidationClaimPointer = {
  id: string;
  kind: string;
  text: string;
  source: {
    tool: 'doc' | 'deck' | 'sheet' | 'pdf' | 'notion' | 'other';
    pointer: string;
    url?: string;
  };
  checks: ValidationClaimCheck[];
};

export type ValidationClaimScore = {
  id: string;
  kind: string;
  passed: boolean;
  required: string;
  passingEvidence: Record<ValidationVerifierKind, number>;
};

export type ValidationScore = {
  totalClaims: number;
  passedClaims: number;
  percent: number;
  claimResults: ValidationClaimScore[];
};

type Requirement = {
  agents?: number;
  humans?: number;
  AND_humans?: number;
  OR_humans?: number;
  OR_agentsPlusFile?: number[];
  OR_agentsPlusContextSummary_humans?: number[];
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

function countPassing(checks: ValidationClaimCheck[]): Record<ValidationVerifierKind, number> {
  const counts: Record<ValidationVerifierKind, number> = {
    agent: 0,
    human: 0,
    file: 0,
    context_summary: 0
  };
  for (const check of checks) {
    if (check.outcome === 'pass') counts[check.verifierKind] += 1;
  }
  return counts;
}

function hasBaseCounts(requirement: Requirement, counts: Record<ValidationVerifierKind, number>): boolean {
  return (
    counts.agent >= (requirement.agents ?? 0) &&
    counts.human >= (requirement.humans ?? 0)
  );
}

function passesRequirement(requirement: Requirement, counts: Record<ValidationVerifierKind, number>): boolean {
  if (requirement.AND_humans !== undefined) {
    return counts.agent >= (requirement.agents ?? 0) && counts.human >= requirement.AND_humans;
  }

  if (requirement.OR_humans !== undefined) {
    return counts.agent >= (requirement.agents ?? 0) || counts.human >= requirement.OR_humans;
  }

  const fileAlternative = requirement.OR_agentsPlusFile;
  if (fileAlternative !== undefined) {
    return (
      counts.agent >= (requirement.agents ?? 0) ||
      (counts.agent >= (fileAlternative[0] ?? 0) && counts.file >= (fileAlternative[1] ?? 0))
    );
  }

  const contextAlternative = requirement.OR_agentsPlusContextSummary_humans;
  if (contextAlternative !== undefined) {
    return (
      counts.agent >= (requirement.agents ?? 0) ||
      (
        counts.agent >= (contextAlternative[0] ?? 0) &&
        counts.context_summary >= (contextAlternative[1] ?? 0) &&
        counts.human >= (contextAlternative[2] ?? 0)
      )
    );
  }

  return hasBaseCounts(requirement, counts);
}

function describeRequirement(requirement: Requirement): string {
  const parts: string[] = [];
  if (requirement.agents !== undefined) parts.push(`${requirement.agents} agents`);
  if (requirement.humans !== undefined) parts.push(`${requirement.humans} humans`);
  if (requirement.AND_humans !== undefined) parts.push(`AND ${requirement.AND_humans} humans`);
  if (requirement.OR_humans !== undefined) parts.push(`OR ${requirement.OR_humans} humans`);
  if (requirement.OR_agentsPlusFile !== undefined) {
    parts.push(`OR ${requirement.OR_agentsPlusFile[0] ?? 0} agents + ${requirement.OR_agentsPlusFile[1] ?? 0} file`);
  }
  if (requirement.OR_agentsPlusContextSummary_humans !== undefined) {
    const alt = requirement.OR_agentsPlusContextSummary_humans;
    parts.push(`OR ${alt[0] ?? 0} agents + ${alt[1] ?? 0} context summaries + ${alt[2] ?? 0} humans`);
  }
  return parts.length > 0 ? parts.join(' ') : 'no verification required';
}

export function scoreValidationClaims(policy: PolicyBody, claims: ValidationClaimPointer[]): ValidationScore {
  const claimResults = claims.map((claim) => {
    const requirement = requirementFor(policy, claim.kind);
    const passingEvidence = countPassing(claim.checks);
    return {
      id: claim.id,
      kind: claim.kind,
      passed: passesRequirement(requirement, passingEvidence),
      required: describeRequirement(requirement),
      passingEvidence
    };
  });

  const passedClaims = claimResults.filter((result) => result.passed).length;
  const percent = claimResults.length === 0
    ? 0
    : Math.round((passedClaims / claimResults.length) * 100);

  return {
    totalClaims: claimResults.length,
    passedClaims,
    percent,
    claimResults
  };
}
