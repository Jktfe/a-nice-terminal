/**
 * verificationTaxonomySeed — seed the ANT default tag set (~25 tags
 * across 8 categories + 2 relational tag families).
 *
 * Per JWPK ratification at the apps coordination thread on 2026-05-28 +
 * deck d5024535-a495-45ea-9e4f-ba11bb197ab8 slide 2.
 *
 * Idempotent — `seedDefaultTaxonomy()` skips tags that already exist
 * (e.g. on server restart). Call from server boot or first-write
 * fallback.
 */

import {
  createTag,
  getLatestTagVersion,
  type CreateTagInput,
  type ProtocolResolver,
  type TagDefinition,
  type VerificationProtocolClass
} from './verificationTaxonomyStore';

const SYSTEM_AUTHOR = '@system';

function staticProtocol(
  protocol: 'deterministic' | 'heuristic' | 'judgement-required' | 'consensus-required'
): ProtocolResolver {
  return { kind: 'static', protocol };
}

function conditional(
  rules: Array<{ when: string; protocol: VerificationProtocolClass }>,
  fallback: VerificationProtocolClass
): ProtocolResolver {
  return { kind: 'conditional', rules, default: fallback };
}

type SeedTag = Omit<CreateTagInput, 'createdBy' | 'provenance' | 'scopeId' | 'actorKind' | 'initialLifecycleState' | 'createReason'>;

/**
 * The default tag set. Each tag carries its category, description, and
 * protocol-resolver shape. Order is grouped by category for review.
 */
const DEFAULT_TAGS: SeedTag[] = [
  // ── claim.* ─────────────────────────────────────────────────────────
  {
    id: 'claim.factual',
    name: 'Factual claim',
    description:
      'A claim asserting a fact about the world that can in principle be checked against an external source. Examples: "The FCA was established in 2013." / "Wells Fargo had revenue of $87bn in 2024."',
    category: 'claim',
    protocolResolver: conditional(
      [{ when: 'has_primary_source', protocol: 'deterministic' as const }],
      'judgement-required'
    ),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'claim.opinion',
    name: 'Opinion claim',
    description:
      'A claim expressing the author\'s opinion. Not factually verifiable; verification covers whether the opinion is appropriately framed (e.g. labelled as opinion, not asserted as fact).',
    category: 'claim',
    protocolResolver: staticProtocol('judgement-required'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'claim.prediction',
    name: 'Prediction claim',
    description:
      'A claim about the future. Verification covers whether the prediction is appropriately qualified (uncertainty, time horizon, assumptions) — not whether it eventually comes true.',
    category: 'claim',
    protocolResolver: staticProtocol('judgement-required'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'claim.definition',
    name: 'Definition claim',
    description:
      'A claim defining a term or concept. Verification checks that the definition matches authoritative usage in the relevant domain.',
    category: 'claim',
    protocolResolver: staticProtocol('heuristic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'claim.ratified-decision',
    name: 'Ratified decision',
    description:
      'A documented decision that has been ratified (e.g. by a board, committee, or named individual). Verification checks the ratification artefact (minutes, sign-off, recorded vote).',
    category: 'claim',
    protocolResolver: staticProtocol('deterministic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  // ── source.* ────────────────────────────────────────────────────────
  {
    id: 'source.primary',
    name: 'Primary source',
    description:
      'A source that is the original or first-hand authority for the information cited (e.g. an SEC filing for a company\'s financials, a regulator\'s rulebook for a regulation).',
    category: 'source',
    protocolResolver: staticProtocol('heuristic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'source.secondary',
    name: 'Secondary source',
    description:
      'A source citing or summarising primary sources (e.g. a journalist article describing an SEC filing).',
    category: 'source',
    protocolResolver: staticProtocol('heuristic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'source.reputable',
    name: 'Reputable source',
    description:
      'A source belonging to a governed source-set for the active lens. Reputation is NOT a global judgement — it is per-lens per-org membership in a source_sets row.',
    category: 'source',
    protocolResolver: staticProtocol('heuristic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'source.unverified',
    name: 'Unverified source',
    description:
      'A source whose authority has not been established for the current lens. Tag persists across versions until promoted (e.g. to source.reputable) or discarded.',
    category: 'source',
    protocolResolver: staticProtocol('heuristic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'source.agent-generated',
    name: 'Agent-generated source',
    description:
      'A source created by an agent (LLM-authored content). Carries a different verification bar than human-authored or primary sources.',
    category: 'source',
    protocolResolver: staticProtocol('consensus-required'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  // ── source.supports-claim.* and source.refutes-claim.* (RELATIONAL FAMILIES) ──
  {
    id: 'source.supports-claim',
    name: 'Source supports claim',
    description:
      'Relational tag family. A source tagged source.supports-claim.<claimID> asserts that the source contains evidence supporting the named claim. Applied with a parameterised id (e.g. source.supports-claim.c0a8b2). Verified by reading the source and confirming it does support the claim — load-bearing for the source-context-verification default lens.',
    category: 'source',
    protocolResolver: staticProtocol('consensus-required'),
    isHumanEditable: true,
    isRelational: true,
    familyRoot: 'source.supports-claim'
  },
  {
    id: 'source.refutes-claim',
    name: 'Source refutes claim',
    description:
      'Relational tag family. A source tagged source.refutes-claim.<claimID> asserts that the source contains evidence refuting the named claim. Applied with a parameterised id. Verified by reading the source and confirming it does refute the claim — load-bearing for the source-context-verification default lens.',
    category: 'source',
    protocolResolver: staticProtocol('consensus-required'),
    isHumanEditable: true,
    isRelational: true,
    familyRoot: 'source.refutes-claim'
  },
  // ── link.* ──────────────────────────────────────────────────────────
  {
    id: 'link.html',
    name: 'HTML link',
    description:
      'A hyperlink to a web page. Verification: HTTP 2xx + archive check (for resilience against link rot).',
    category: 'link',
    protocolResolver: staticProtocol('deterministic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'link.file',
    name: 'File link',
    description:
      'A link to a file (local or shared filesystem). Verification: file exists + hash matches recorded value (if any).',
    category: 'link',
    protocolResolver: staticProtocol('deterministic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'link.repo',
    name: 'Repo link',
    description:
      'A link to a source-control resource (commit, file, PR, issue). Verification: resource exists at the named ref.',
    category: 'link',
    protocolResolver: staticProtocol('deterministic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  // ── data.* ──────────────────────────────────────────────────────────
  {
    id: 'data.raw-number',
    name: 'Raw number',
    description:
      'A standalone numerical value. Verification: parseable + within reasonable range for the context.',
    category: 'data',
    protocolResolver: staticProtocol('deterministic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'data.formula',
    name: 'Formula',
    description:
      'A mathematical formula. Verification: evaluable + produces the stated result when applied to its inputs.',
    category: 'data',
    protocolResolver: staticProtocol('deterministic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'data.percentage',
    name: 'Percentage',
    description:
      'A value expressed as a percentage. Verification: numerator/denominator both verifiable; percentage matches the computation.',
    category: 'data',
    protocolResolver: staticProtocol('deterministic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  // ── identity.* ──────────────────────────────────────────────────────
  {
    id: 'identity.named-person',
    name: 'Named person',
    description:
      'A reference to a specific named individual. Verification: identity exists + role/attribution matches.',
    category: 'identity',
    protocolResolver: staticProtocol('heuristic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'identity.named-org',
    name: 'Named organisation',
    description:
      'A reference to a specific named organisation. Verification: organisation exists + name spelling is canonical.',
    category: 'identity',
    protocolResolver: staticProtocol('heuristic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  // ── content.* ───────────────────────────────────────────────────────
  {
    id: 'content.direct-quote',
    name: 'Direct quote',
    description:
      'A direct quote from a source. Verification: string match against the cited source.',
    category: 'content',
    protocolResolver: staticProtocol('deterministic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  {
    id: 'content.paraphrase',
    name: 'Paraphrase',
    description:
      'A paraphrased restatement of a source. Verification: meaning preserved, not just words.',
    category: 'content',
    protocolResolver: staticProtocol('judgement-required'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  // ── context.* ───────────────────────────────────────────────────────
  {
    id: 'context.time-bound',
    name: 'Time-bound assertion',
    description:
      'An assertion whose truth depends on time (e.g. "as of 2024"). Verification: date qualifier present + current/historical sense disambiguated.',
    category: 'context',
    protocolResolver: staticProtocol('heuristic'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  },
  // ── process.* ───────────────────────────────────────────────────────
  {
    id: 'process.flagged-ignorable',
    name: 'Flagged as ignorable',
    description:
      'A human (or agent on behalf of human) has flagged this content as not requiring verification. Example: jokes, hyperbole, hypothetical content. The flagger\'s identity + reason is mandatorily audited (audit-of-flagger is VITAL per JWPK ratification).',
    category: 'process',
    protocolResolver: staticProtocol('judgement-required'),
    isHumanEditable: true,
    isRelational: false,
    familyRoot: null
  }
];

/**
 * Seed the ANT default tag set. Idempotent — skips tags that already
 * exist (so server restart / migration replay is safe).
 *
 * Returns the list of newly-created tags (does not include skipped).
 */
export function seedDefaultTaxonomy(): TagDefinition[] {
  const created: TagDefinition[] = [];
  for (const seed of DEFAULT_TAGS) {
    const existing = getLatestTagVersion(seed.id);
    if (existing) continue;
    const def = createTag({
      ...seed,
      provenance: 'system',
      scopeId: 'global',
      createdBy: SYSTEM_AUTHOR,
      actorKind: 'system',
      initialLifecycleState: 'active',
      createReason: 'ANT default taxonomy v0 seed'
    });
    created.push(def);
  }
  return created;
}

/** Exposed for tests + admin verification. */
export function getDefaultTaxonomyIds(): string[] {
  return DEFAULT_TAGS.map((t) => t.id);
}
