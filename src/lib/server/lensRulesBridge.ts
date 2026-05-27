/**
 * lensRulesBridge — bridge from `validation_schemas.rules_json` (v2
 * authoring shape) to the executable `PolicyBody` consumed by
 * `scoreValidationClaims` + `planValidationOrchestration`.
 *
 * Per orsz msg_2v6i1v1ihs + msg_y0vyfm9j1l (@speedycodex split + v2
 * shape proposal accepted msg_bge8evne1j). The lens designer UI writes
 * v2 JSON into rules_json; this module is the bridge that lowers it
 * into the legacy PolicyBody shape so existing downstream code paths
 * remain unchanged.
 *
 * v2 authoring shape:
 *   {
 *     "version": 2,
 *     "blocks": {
 *       "<block-kind>": {
 *         "mode": "all" | "any" | "none",
 *         "reason"?: string,        // required when mode='none'
 *         "requirements": [          // omitted when mode='none'
 *           { "kind": "agent" | "person" | "source" | "file" |
 *                       "filesystem" | "website" | "context_summary",
 *             "count": number,
 *             "specific"?: string[],         // for agent/person
 *             "allowedSources"?: string[],   // for source
 *             "specificFiles"?: string[],    // for file
 *             "allowedDomains"?: string[]    // for website
 *           }
 *         ]
 *       }
 *     },
 *     "fallback": {  // same shape, applies when no block matches
 *       "mode": ..., "requirements": [...]
 *     }
 *   }
 *
 * Legacy `[]` or any non-object payload resolves to an empty rules set
 * (no requirements anywhere — every claim falls through to fallback,
 * which is also empty, so nothing is gated).
 *
 * Conversion to PolicyBody:
 *   - `kind: 'agent'`  → `requirement.agents`
 *   - `kind: 'person'` → `requirement.humans` (legacy field name)
 *   - `kind: 'file' | 'filesystem'` → `requirement.OR_agentsPlusFile`
 *       collapses the "agents + N files alternative route" path
 *   - `kind: 'source' | 'website' | 'context_summary'` → contributes
 *       to `OR_agentsPlusFile` v1 (until the scorer learns richer kinds
 *       in a follow-up slice)
 *   - `mode: 'any'` → expressed via `OR_humans` for the human alt + the
 *       primary agent count
 *   - `mode: 'all'` → expressed via `AND_humans` when humans are present
 *   - `mode: 'none'` → no requirement emitted (block waived; reason
 *       preserved on the LensRules side for audit only)
 *
 * `specific`, `allowedSources`, `specificFiles`, `allowedDomains` are
 * surfaced via `extractAssignmentConstraints` for the orchestrator to
 * gate verifier ASSIGNMENT — they don't affect scoring COUNTS. (The
 * scorer doesn't care WHO verified, just HOW MANY of each kind.)
 */

import type { PolicyBody } from './policyStore';

export type LensRequirementKind =
  | 'agent'
  | 'person'
  | 'source'
  | 'file'
  | 'filesystem'
  | 'website'
  | 'context_summary';

export type LensBlockMode = 'all' | 'any' | 'none';

export type LensRequirement = {
  kind: LensRequirementKind;
  count: number;
  specific?: string[];
  allowedSources?: string[];
  specificFiles?: string[];
  allowedDomains?: string[];
};

export type LensBlock = {
  mode: LensBlockMode;
  /** Required when mode='none'; explains why verification was waived. */
  reason?: string;
  /** Empty when mode='none'; one or more entries otherwise. */
  requirements?: LensRequirement[];
};

export type LensRules = {
  version?: 2;
  blocks?: Record<string, LensBlock>;
  fallback?: LensBlock;
};

export type LensAssignmentConstraints = {
  byBlockKind: Record<string, BlockAssignmentConstraints>;
  fallback?: BlockAssignmentConstraints;
};

export type BlockAssignmentConstraints = {
  specific?: string[];
  allowedSources?: string[];
  specificFiles?: string[];
  allowedDomains?: string[];
};

const VALID_KINDS: readonly LensRequirementKind[] = [
  'agent',
  'person',
  'source',
  'file',
  'filesystem',
  'website',
  'context_summary'
];
const VALID_MODES: readonly LensBlockMode[] = ['all', 'any', 'none'];

function positiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) out.push(item.trim());
  }
  return out.length > 0 ? out : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseRequirement(raw: unknown): LensRequirement | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== 'string' || !(VALID_KINDS as readonly string[]).includes(kind)) return null;
  const count = positiveInt(record.count);
  if (count === undefined) return null;
  const requirement: LensRequirement = { kind: kind as LensRequirementKind, count };
  const specific = stringArray(record.specific);
  if (specific) requirement.specific = specific;
  const allowedSources = stringArray(record.allowedSources);
  if (allowedSources) requirement.allowedSources = allowedSources;
  const specificFiles = stringArray(record.specificFiles);
  if (specificFiles) requirement.specificFiles = specificFiles;
  const allowedDomains = stringArray(record.allowedDomains);
  if (allowedDomains) requirement.allowedDomains = allowedDomains;
  return requirement;
}

function parseBlock(raw: unknown): LensBlock | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const mode = record.mode;
  if (typeof mode !== 'string' || !(VALID_MODES as readonly string[]).includes(mode)) return null;
  const block: LensBlock = { mode: mode as LensBlockMode };
  const reason = nonEmptyString(record.reason);
  if (reason !== undefined) block.reason = reason;
  if (mode === 'none') {
    // Explicit waiver — no requirements expected. Drop any that snuck in.
    return block;
  }
  if (!Array.isArray(record.requirements)) return null;
  const requirements: LensRequirement[] = [];
  for (const raw of record.requirements) {
    const requirement = parseRequirement(raw);
    if (requirement) requirements.push(requirement);
  }
  if (requirements.length === 0) return null;
  block.requirements = requirements;
  return block;
}

/**
 * Parse the JSON string stored in `validation_schemas.rules_json` into
 * a structured `LensRules`. Returns `null` only when the JSON itself is
 * malformed. Legacy `[]`, empty objects, or non-object payloads
 * resolve to an empty rules set (`{}`) — no requirements anywhere.
 */
export function parseLensRulesJson(rulesJson: string): LensRules | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rulesJson);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const rules: LensRules = {};
  if (record.version === 2) rules.version = 2;
  if (record.blocks && typeof record.blocks === 'object' && !Array.isArray(record.blocks)) {
    const blocksByKind: Record<string, LensBlock> = {};
    for (const [kind, raw] of Object.entries(record.blocks as Record<string, unknown>)) {
      const block = parseBlock(raw);
      if (block) blocksByKind[kind] = block;
    }
    if (Object.keys(blocksByKind).length > 0) rules.blocks = blocksByKind;
  }
  const fallback = parseBlock(record.fallback);
  if (fallback) rules.fallback = fallback;
  return rules;
}

type CountsByKind = Partial<Record<LensRequirementKind, number>>;

function countsByKind(requirements: readonly LensRequirement[]): CountsByKind {
  const counts: CountsByKind = {};
  for (const requirement of requirements) {
    counts[requirement.kind] = (counts[requirement.kind] ?? 0) + requirement.count;
  }
  return counts;
}

/**
 * Lower a single `LensBlock` to a legacy `PolicyBody` requirement
 * record. `mode: 'none'` returns an empty object (no slots created
 * by the orchestrator; nothing requires verification).
 */
function blockToPolicyRequirement(block: LensBlock): Record<string, unknown> {
  if (block.mode === 'none' || !block.requirements || block.requirements.length === 0) {
    return {};
  }
  const counts = countsByKind(block.requirements);
  const agents = counts.agent ?? 0;
  const people = counts.person ?? 0;
  // file/filesystem collapse to "files" today; richer kinds learnt
  // by the scorer in a follow-up slice without breaking the bridge.
  const files = (counts.file ?? 0) + (counts.filesystem ?? 0);
  // source/website/context_summary all act as alt-route source-of-truth
  // gates in v1 — surface them via OR_agentsPlusFile until the scorer
  // learns the richer kinds.
  const sourcesLike =
    (counts.source ?? 0) + (counts.website ?? 0) + (counts.context_summary ?? 0);

  const policy: Record<string, unknown> = {};
  if (agents > 0) policy.agents = agents;
  if (people > 0) {
    if (block.mode === 'all') {
      // mode='all' means every requirement must be met → AND-compose
      // agents and humans.
      policy.AND_humans = people;
    } else {
      // mode='any' → OR-compose: agents OR humans satisfies the block.
      policy.OR_humans = people;
    }
  }
  if (files > 0 || sourcesLike > 0) {
    // Alt route: same number of agents plus (files + source-likes).
    // Scorer treats them as a single fallback when humans aren't met.
    policy.OR_agentsPlusFile = [agents, files + sourcesLike];
  }
  return policy;
}

/**
 * Convert a parsed `LensRules` to the `PolicyBody` shape consumed by
 * `scoreValidationClaims` + `planValidationOrchestration`. Empty rules
 * yield an empty PolicyBody (`{}`) — every claim falls through to
 * fallback, which is also empty, so no verification gates are created.
 *
 * `extractAssignmentConstraints` returns the specific-* / allowed-* /
 * specificFiles fields separately for the orchestrator.
 */
export function lensRulesToPolicyBody(rules: LensRules): PolicyBody {
  const body: PolicyBody = {};
  if (rules.blocks && Object.keys(rules.blocks).length > 0) {
    const blocks: Record<string, unknown> = {};
    for (const [kind, block] of Object.entries(rules.blocks)) {
      blocks[kind] = blockToPolicyRequirement(block);
    }
    body.blocks = blocks;
  }
  if (rules.fallback) {
    body.fallback = blockToPolicyRequirement(rules.fallback);
  }
  return body;
}

function blockAssignmentConstraints(block: LensBlock): BlockAssignmentConstraints | null {
  if (!block.requirements || block.requirements.length === 0) return null;
  const constraints: BlockAssignmentConstraints = {};
  for (const requirement of block.requirements) {
    if (requirement.specific) {
      constraints.specific = [...(constraints.specific ?? []), ...requirement.specific];
    }
    if (requirement.allowedSources) {
      constraints.allowedSources = [
        ...(constraints.allowedSources ?? []),
        ...requirement.allowedSources
      ];
    }
    if (requirement.specificFiles) {
      constraints.specificFiles = [
        ...(constraints.specificFiles ?? []),
        ...requirement.specificFiles
      ];
    }
    if (requirement.allowedDomains) {
      constraints.allowedDomains = [
        ...(constraints.allowedDomains ?? []),
        ...requirement.allowedDomains
      ];
    }
  }
  return Object.keys(constraints).length > 0 ? constraints : null;
}

/**
 * Surface the orchestrator-relevant constraints (specific verifiers,
 * allowed sources/domains, specific files) from a parsed LensRules.
 * Returns `null` when no constraints are set anywhere.
 */
export function extractAssignmentConstraints(
  rules: LensRules
): LensAssignmentConstraints | null {
  const byBlockKind: Record<string, BlockAssignmentConstraints> = {};
  if (rules.blocks) {
    for (const [kind, block] of Object.entries(rules.blocks)) {
      const constraints = blockAssignmentConstraints(block);
      if (constraints) byBlockKind[kind] = constraints;
    }
  }
  let fallback: BlockAssignmentConstraints | undefined;
  if (rules.fallback) {
    const constraints = blockAssignmentConstraints(rules.fallback);
    if (constraints) fallback = constraints;
  }
  if (Object.keys(byBlockKind).length === 0 && fallback === undefined) return null;
  const result: LensAssignmentConstraints = { byBlockKind };
  if (fallback) result.fallback = fallback;
  return result;
}

/**
 * Convenience: parse a raw `rules_json` string straight to a
 * `PolicyBody`. Returns `null` if the JSON is malformed. Empty rules
 * resolve to an empty-but-valid PolicyBody (`{}`).
 */
export function rulesJsonToPolicyBody(rulesJson: string): PolicyBody | null {
  const rules = parseLensRulesJson(rulesJson);
  if (rules === null) return null;
  return lensRulesToPolicyBody(rules);
}
