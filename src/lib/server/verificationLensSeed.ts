/**
 * verificationLensSeed — Phase B4 default lens scaffolds.
 *
 * Per the plan acceptance: "link-verify-1-agent + link-verify-2-agent +
 * source-context-1h1a lenses seeded at server bootstrap; all reference
 * real lens schema".
 *
 * Three default lenses cover the most common verification shapes the
 * substrate supports out-of-the-box:
 *
 * 1. **link-verify-1-agent** — single-agent link checking. Cheap +
 *    fast. For internal documents where one agent verifying every
 *    cited URL is sufficient.
 *
 * 2. **link-verify-2-agent** — two-agent consensus on links. For
 *    higher-stakes documents (regulatory filings, public marketing
 *    materials) where one agent could miss something. Majority dispute
 *    policy resolves the tie-break case.
 *
 * 3. **source-context-1h1a** — source-context verification with one
 *    human + one agent verifier. For claim-heavy content (analyst
 *    notes, investment memos) where claims need source attribution
 *    and the source itself needs context (primary vs secondary,
 *    reputable, supports vs refutes the claim).
 *
 * These are LENS SCAFFOLDS, not full canned regulatory lenses (per
 * JWPK direction during 17-question ratification: no canned FCA/ONS
 * lenses; orgs build their own via the lens-creation skill in B1-B3).
 * The scaffolds give consumers a working starting point + reference
 * implementation showing how lens_tag_rows compose.
 *
 * Idempotent: each seed call skips lenses that already exist by id.
 */

import { createValidationSchema, getValidationSchema } from './validationLensStore';
import { createLensTagRow, listLensTagRows } from './lensTagRowsStore';
import type { LensTagExpectation, LensTagDisputePolicy } from './lensTagRowsStore';

const SYSTEM_AUTHOR = '@ant-system';

interface SeedRow {
  tagId: string;
  expectation: LensTagExpectation;
  minVerifierCount?: number;
  verifierMix?: string[];
  disputePolicy?: LensTagDisputePolicy;
  weight?: number;
  notes: string;
}

interface SeedLens {
  id: string;
  name: string;
  description: string;
  lensKind: 'poc' | 'fca' | 'investment_memo' | 'scientific_claim' | 'marketing_copy' | 'custom';
  rows: SeedRow[];
}

const DEFAULT_LENSES: SeedLens[] = [
  {
    id: 'lens-link-verify-1-agent',
    name: 'Link verification (1 agent)',
    description:
      'Single-agent link checking — every cited URL is verified by one agent. Cheap + fast; suitable for internal documents.',
    lensKind: 'custom',
    rows: [
      {
        tagId: 'link.html',
        expectation: 'required',
        minVerifierCount: 1,
        disputePolicy: 'any-pass',
        notes: 'Every HTML link must resolve + render expected content. One agent verifier is sufficient.'
      },
      {
        tagId: 'link.file',
        expectation: 'required',
        minVerifierCount: 1,
        disputePolicy: 'any-pass',
        notes: 'Every file link must exist + be readable. One agent verifier is sufficient.'
      },
      {
        tagId: 'link.repo',
        expectation: 'required',
        minVerifierCount: 1,
        disputePolicy: 'any-pass',
        notes: 'Every repo reference must resolve to the named commit/ref. One agent verifier is sufficient.'
      }
    ]
  },
  {
    id: 'lens-link-verify-2-agent',
    name: 'Link verification (2 agent consensus)',
    description:
      'Two-agent consensus on every link. For regulatory filings + public marketing materials where one agent could miss a broken link. Majority dispute policy resolves the tie-break.',
    lensKind: 'custom',
    rows: [
      {
        tagId: 'link.html',
        expectation: 'consensus-required',
        minVerifierCount: 2,
        disputePolicy: 'majority',
        notes: '2 agents must converge on HTML link validity. Majority resolves disagreement.'
      },
      {
        tagId: 'link.file',
        expectation: 'consensus-required',
        minVerifierCount: 2,
        disputePolicy: 'majority',
        notes: '2 agents must converge on file link validity.'
      },
      {
        tagId: 'link.repo',
        expectation: 'consensus-required',
        minVerifierCount: 2,
        disputePolicy: 'majority',
        notes: '2 agents must converge on repo ref validity.'
      },
      {
        tagId: 'process.flagged-ignorable',
        expectation: 'out-of-scope',
        notes: 'Rows flagged as ignorable (jokes, examples) are excluded from this lens.'
      }
    ]
  },
  {
    id: 'lens-source-context-1h1a',
    name: 'Source-context verification (1 human + 1 agent)',
    description:
      'Source-context verification for claim-heavy content. Every factual claim needs source attribution; every source needs context (primary vs secondary, reputable, supports/refutes). 1 human + 1 agent verifier per claim — humans catch nuance, agents catch scale.',
    lensKind: 'investment_memo',
    rows: [
      {
        tagId: 'claim.factual',
        expectation: 'required',
        minVerifierCount: 2,
        verifierMix: ['@human-reviewer', '@agent-verifier'],
        disputePolicy: 'unanimous',
        notes: 'Every factual claim must have at least one supporting source. Human + agent must agree on whether the source supports the claim.'
      },
      {
        tagId: 'source.supports-claim',
        expectation: 'required',
        minVerifierCount: 1,
        disputePolicy: 'any-pass',
        notes: 'Each factual claim must carry at least one source.supports-claim relational tag pointing at a real source.'
      },
      {
        tagId: 'source.primary',
        expectation: 'heuristic-allowed',
        minVerifierCount: 1,
        weight: 2.0,
        notes: 'Primary sources weighted 2x in the trust score; tagged via heuristic check.'
      },
      {
        tagId: 'source.reputable',
        expectation: 'heuristic-allowed',
        minVerifierCount: 1,
        weight: 1.5,
        notes: 'Reputable sources weighted 1.5x. Source-set governance enforced separately.'
      },
      {
        tagId: 'source.refutes-claim',
        expectation: 'consensus-required',
        minVerifierCount: 2,
        verifierMix: ['@human-reviewer', '@agent-verifier'],
        disputePolicy: 'escalate',
        notes: 'When a source refutes a claim, both verifiers must agree before the claim is marked failed. Disagreement escalates to lens owner.'
      },
      {
        tagId: 'source.unverified',
        expectation: 'forbidden',
        notes: 'Unverified sources are not permitted to support claims under this lens. Forces escalation to a real source.'
      },
      {
        tagId: 'content.direct-quote',
        expectation: 'required',
        minVerifierCount: 2,
        verifierMix: ['@human-reviewer', '@agent-verifier'],
        disputePolicy: 'unanimous',
        notes: 'Direct quotes must be verified verbatim against the source. Both verifiers must agree.'
      },
      {
        tagId: 'process.flagged-ignorable',
        expectation: 'out-of-scope',
        notes: 'Ignorable rows (examples, hypotheticals) excluded.'
      }
    ]
  }
];

/**
 * Seed the three default lens scaffolds. Idempotent — lenses with the
 * canonical ids that already exist are skipped (so server restart is
 * safe).
 *
 * Returns the ids of newly-seeded lenses (does not include skipped).
 */
export function seedDefaultLenses(): string[] {
  const created: string[] = [];
  for (const lens of DEFAULT_LENSES) {
    if (getValidationSchema(lens.id)) continue;
    createValidationSchema({
      id: lens.id,
      name: lens.name,
      description: lens.description,
      lensKind: lens.lensKind,
      scope: 'public',
      scopeId: 'global',
      rulesJson: '[]', // legacy column; new authoring lives in lens_tag_rows
      createdBy: SYSTEM_AUTHOR,
      archivedAtMs: null
    });
    // Only seed rows if the lens itself is brand new — if it exists
    // already we skip everything (idempotency boundary).
    const existingRows = listLensTagRows(lens.id);
    if (existingRows.length === 0) {
      for (const row of lens.rows) {
        createLensTagRow({
          lensId: lens.id,
          tagId: row.tagId,
          expectation: row.expectation,
          minVerifierCount: row.minVerifierCount,
          verifierMix: row.verifierMix,
          disputePolicy: row.disputePolicy,
          weight: row.weight,
          notes: row.notes,
          createdBy: SYSTEM_AUTHOR
        });
      }
    }
    created.push(lens.id);
  }
  return created;
}

/** Exposed for tests + admin verification. */
export function getDefaultLensIds(): string[] {
  return DEFAULT_LENSES.map((l) => l.id);
}
