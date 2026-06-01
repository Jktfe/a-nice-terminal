/**
 * POST /api/artefacts/:artefactId/validate
 *
 * Applies a verification policy as a lens over an existing room artefact.
 * The artefact stays unchanged; the response gives claim anchors, score,
 * and routing gaps for the selected lens.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getArtefact } from '$lib/server/chatRoomArtefactStore';
import { getArtefactContentByArtefactId } from '$lib/server/chatRoomArtefactContentStore';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess, type ChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { CURRENT_TIER, getFeatureFlagsForTier } from '$lib/server/featureGates';
import { getPolicyBySlug, type Policy, type PolicyBody } from '$lib/server/policyStore';
import {
  JKS_VALIDATION_RULE_NAME,
  JKS_VALIDATION_RULE_POLICY,
  JKS_VALIDATION_RULE_SLUG
} from '$lib/server/validationPolicyPresets';
import { extractMarkdownValidationClaimPointers } from '$lib/server/validationMarkdownExtractor';
import { univerSnapshotToPlainText } from '$lib/univer/univerTextElements';
import { scoreValidationClaims, type ValidationVerifierKind } from '$lib/server/validationScoring';
import {
  planValidationOrchestration,
  type ValidationParticipant
} from '$lib/server/validationOrchestrator';
import { createValidationWorkItems } from '$lib/server/validationWorkItems';
import {
  getValidationSchema,
  listValidationRunsForClaim,
  type ValidationRun,
  type ValidationSchema
} from '$lib/server/validationLensStore';
import { rulesJsonToPolicyBody } from '$lib/server/lensRulesBridge';
import type { ValidationClaimCheck, ValidationClaimPointer } from '$lib/server/validationScoring';

type ValidateArtefactPayload = {
  policySlug?: unknown;
  /**
   * V2 lens schema id. When supplied, the executable PolicyBody is
   * derived from the schema's stored `rules_json` via the lens-rules
   * bridge instead of looking up a hand-authored policy by slug. Mutually
   * exclusive with `policySlug` — sending both is a 400.
   *
   * Wired 2026-05-27 after @speedycodex shipped 8a8611d (CRUD + audit)
   * and unblocked this layer in orsz msg_cf99778tsw.
   */
  lensSchemaId?: unknown;
  participants?: unknown;
  createWork?: unknown;
  maxWorkItems?: unknown;
};

type ValidationLens = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  policy: PolicyBody;
};

type StoredArtefact = NonNullable<ReturnType<typeof getArtefact>>;
type StoredArtefactContent = NonNullable<ReturnType<typeof getArtefactContentByArtefactId>>;

function isPublicUniverDemoValidation(input: {
  artefact: StoredArtefact;
  content: StoredArtefactContent;
  policySlug: string;
  createWork: unknown;
}): boolean {
  return (
    input.artefact.id.startsWith('univer_demo_') &&
    input.content.id.startsWith('univer_demo_content_') &&
    input.content.contentFormat === 'univer-json' &&
    input.content.kind === 'deck' &&
    input.policySlug === JKS_VALIDATION_RULE_SLUG &&
    input.createWork !== true
  );
}

function publicDemoAccess(roomId: string): ChatRoomReadAccess {
  return {
    isAdminBearer: false,
    source: 'room-invite-bearer',
    handles: ['@you'],
    principalHandles: ['@you'],
    resolvedRoomIds: [roomId]
  };
}

function readablePolicy(policy: Policy, access: ChatRoomReadAccess): ValidationLens {
  if (policy.deletedAtMs !== null) throw error(404, 'Validation lens not found.');
  if (policy.visibility !== 'private' || access.isAdminBearer) return policy;
  if (access.handles.includes(policy.ownerHandle) || access.principalHandles?.includes(policy.ownerHandle)) {
    return policy;
  }
  throw error(403, 'Validation lens is private.');
}

function resolveValidationLens(slug: string, access: ChatRoomReadAccess): ValidationLens {
  const stored = getPolicyBySlug(slug);
  if (stored) return readablePolicy(stored, access);
  if (slug === JKS_VALIDATION_RULE_SLUG) {
    return {
      id: `preset:${JKS_VALIDATION_RULE_SLUG}`,
      slug: JKS_VALIDATION_RULE_SLUG,
      name: JKS_VALIDATION_RULE_NAME,
      description: 'Built-in validation lens. Store it as a policy when you want to edit or audit it.',
      policy: JKS_VALIDATION_RULE_POLICY
    };
  }
  throw error(404, 'Validation lens not found.');
}

function isLensSchemaVisibleTo(schema: ValidationSchema, access: ChatRoomReadAccess): boolean {
  if (access.isAdminBearer) return true;
  if (schema.scope === 'public') return true;
  if (schema.scope === 'user') {
    return (
      access.handles.includes(schema.scopeId) ||
      (access.principalHandles?.includes(schema.scopeId) ?? false)
    );
  }
  // 'org' scope visibility — the caller-side org membership isn't surfaced
  // on ChatRoomReadAccess yet, so non-admin org-scoped schemas resolve as
  // not-visible until that signal lands. Public + user + admin cover the
  // demand for V2; org lenses are an explicit follow-up.
  return false;
}

function resolveValidationLensFromSchemaId(
  lensSchemaId: string,
  access: ChatRoomReadAccess
): ValidationLens {
  const schema = getValidationSchema(lensSchemaId);
  if (!schema) throw error(404, 'Validation lens not found.');
  if (schema.archivedAtMs !== null) throw error(404, 'Validation lens has been archived.');
  if (!isLensSchemaVisibleTo(schema, access)) throw error(404, 'Validation lens not found.');
  const policy = rulesJsonToPolicyBody(schema.rulesJson);
  if (policy === null) throw error(400, 'Validation lens rules_json is malformed.');
  return {
    id: schema.id,
    slug: schema.id,
    name: schema.name,
    description: schema.description,
    policy
  };
}

function parseParticipant(value: unknown): ValidationParticipant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as { kind?: unknown; handle?: unknown };
  if (
    raw.kind !== 'agent' &&
    raw.kind !== 'human' &&
    raw.kind !== 'file' &&
    raw.kind !== 'context_summary'
  ) {
    return null;
  }
  if (typeof raw.handle !== 'string' || raw.handle.trim().length === 0) return null;
  return {
    kind: raw.kind as ValidationVerifierKind,
    handle: raw.handle.trim()
  };
}

function parseParticipants(value: unknown): ValidationParticipant[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseParticipant)
    .filter((participant): participant is ValidationParticipant => participant !== null);
}

function verifierKindFromRun(run: ValidationRun): ValidationVerifierKind | null {
  if (!run.resultJson) return null;
  let parsed: { verifierKind?: unknown };
  try {
    parsed = JSON.parse(run.resultJson) as { verifierKind?: unknown };
  } catch {
    return null;
  }
  if (
    parsed.verifierKind === 'agent' ||
    parsed.verifierKind === 'human' ||
    parsed.verifierKind === 'file' ||
    parsed.verifierKind === 'context_summary'
  ) {
    return parsed.verifierKind;
  }
  return null;
}

function checkFromRun(run: ValidationRun): ValidationClaimCheck | null {
  if (run.status !== 'passed' && run.status !== 'failed') return null;
  const verifierKind = verifierKindFromRun(run);
  if (!verifierKind) return null;
  return {
    verifierKind,
    outcome: run.status === 'passed' ? 'pass' : 'fail'
  };
}

function applyValidationRuns(
  claims: ValidationClaimPointer[],
  schemaId: string
): ValidationClaimPointer[] {
  return claims.map((claim) => {
    const checks = listValidationRunsForClaim(claim.id)
      .filter((run) => run.schemaId === schemaId)
      .map(checkFromRun)
      .filter((check): check is ValidationClaimCheck => check !== null);
    return {
      ...claim,
      checks: [...claim.checks, ...checks]
    };
  });
}

export const POST: RequestHandler = async ({ params, request }) => {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_api) {
    throw error(402, 'Validation API is not available on this tier.');
  }

  const artefact = getArtefact(params.artefactId);
  if (!artefact) throw error(404, 'Artefact not found.');

  const room = findChatRoomById(artefact.roomId);
  if (!room) throw error(404, 'Room not found.');

  const payload = (await request.json().catch(() => ({}))) as ValidateArtefactPayload;
  const rawPolicySlug =
    typeof payload.policySlug === 'string' && payload.policySlug.trim().length > 0
      ? payload.policySlug.trim()
      : null;
  const rawLensSchemaId =
    typeof payload.lensSchemaId === 'string' && payload.lensSchemaId.trim().length > 0
      ? payload.lensSchemaId.trim()
      : null;
  if (rawPolicySlug !== null && rawLensSchemaId !== null) {
    throw error(400, 'Send either policySlug or lensSchemaId, not both.');
  }
  // Slug used for the public-univer-demo gate retains backwards compatibility:
  // demo path only fires for policy-slug requests, never for lens-schema-id.
  const policySlug = rawPolicySlug ?? JKS_VALIDATION_RULE_SLUG;

  const content = getArtefactContentByArtefactId(artefact.id);
  if (!content) throw error(404, 'Artefact has no stored body to validate.');
  if (content.roomId !== artefact.roomId) throw error(404, 'Artefact content is not in this room.');
  if (content.kind !== 'doc' && content.kind !== 'deck') {
    throw error(400, 'Only doc and deck artefacts can be validated in this slice.');
  }

  const access =
    rawLensSchemaId === null &&
    isPublicUniverDemoValidation({
      artefact,
      content,
      policySlug,
      createWork: payload.createWork
    })
      ? publicDemoAccess(artefact.roomId)
      : await requireChatRoomReadAccess(request, room);
  const lens =
    rawLensSchemaId !== null
      ? resolveValidationLensFromSchemaId(rawLensSchemaId, access)
      : resolveValidationLens(policySlug, access);

  let validationText = content.contentBody;
  if (content.contentFormat === 'univer-json') {
    try {
      validationText = univerSnapshotToPlainText(JSON.parse(content.contentBody));
    } catch {
      throw error(400, 'Univer JSON artefact body is malformed.');
    }
  }

  const extractedClaims = extractMarkdownValidationClaimPointers({
    markdown: validationText,
    sourcePointer: `artefact:${artefact.id}`,
    url: `/artefacts/${artefact.id}`
  }).map((claim) => ({
    ...claim,
    source: {
      ...claim.source,
      tool: content.kind
    }
  }));
  const claims = applyValidationRuns(extractedClaims, lens.slug);
  const score = scoreValidationClaims(lens.policy, claims);
  const participants = parseParticipants(payload.participants);
  const orchestration = planValidationOrchestration({
    policy: lens.policy,
    claims,
    participants
  });
  const createWork = payload.createWork === true;
  const maxWorkItems = typeof payload.maxWorkItems === 'number' && Number.isFinite(payload.maxWorkItems)
    ? payload.maxWorkItems
    : undefined;
  const workItems = createWork
    ? createValidationWorkItems({
        artefactId: artefact.id,
        roomId: artefact.roomId,
        lensSlug: lens.slug,
        orchestration,
        createdBy: access.principalHandles?.[0] ?? access.handles[0] ?? '@admin',
        maxItems: maxWorkItems
      })
    : [];

  return json({
    artefact: {
      id: artefact.id,
      roomId: artefact.roomId,
      kind: artefact.kind,
      title: artefact.title,
      refUrl: artefact.refUrl
    },
    lens: {
      id: lens.id,
      slug: lens.slug,
      name: lens.name,
      description: lens.description
    },
    claims,
    score,
    orchestration,
    validationWork: createWork
      ? {
          created: workItems.filter((item) => !item.reused).length,
          reused: workItems.filter((item) => item.reused).length,
          items: workItems.map((item) => ({
            taskId: item.task.id,
            taskTitle: item.task.title,
            claimId: item.claimId,
            claimText: item.claimText,
            sourcePointer: item.sourcePointer,
            verifierKind: item.verifierKind,
            assignedTo: item.assignedTo,
            reason: item.reason,
            reused: item.reused
          }))
        }
      : null
  });
};
