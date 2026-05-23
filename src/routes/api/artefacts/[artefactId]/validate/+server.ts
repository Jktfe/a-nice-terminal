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
import { scoreValidationClaims, type ValidationVerifierKind } from '$lib/server/validationScoring';
import {
  planValidationOrchestration,
  type ValidationParticipant
} from '$lib/server/validationOrchestrator';
import { createValidationWorkItems } from '$lib/server/validationWorkItems';

type ValidateArtefactPayload = {
  policySlug?: unknown;
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

export const POST: RequestHandler = async ({ params, request }) => {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_api) {
    throw error(402, 'Validation API is not available on this tier.');
  }

  const artefact = getArtefact(params.artefactId);
  if (!artefact) throw error(404, 'Artefact not found.');

  const room = findChatRoomById(artefact.roomId);
  if (!room) throw error(404, 'Room not found.');
  const access = await requireChatRoomReadAccess(request, room);

  const payload = (await request.json().catch(() => ({}))) as ValidateArtefactPayload;
  const policySlug = typeof payload.policySlug === 'string' && payload.policySlug.trim().length > 0
    ? payload.policySlug.trim()
    : JKS_VALIDATION_RULE_SLUG;
  const lens = resolveValidationLens(policySlug, access);

  const content = getArtefactContentByArtefactId(artefact.id);
  if (!content) throw error(404, 'Artefact has no stored body to validate.');
  if (content.roomId !== artefact.roomId) throw error(404, 'Artefact content is not in this room.');
  if (content.contentFormat !== 'markdown') {
    throw error(400, 'Only markdown artefacts can be validated in this slice.');
  }
  if (content.kind !== 'doc' && content.kind !== 'deck') {
    throw error(400, 'Only doc and deck artefacts can be validated in this slice.');
  }

  const claims = extractMarkdownValidationClaimPointers({
    markdown: content.contentBody,
    sourcePointer: `artefact:${artefact.id}`,
    url: `/artefacts/${artefact.id}`
  }).map((claim) => ({
    ...claim,
    source: {
      ...claim.source,
      tool: content.kind
    }
  }));
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
            reason: item.reason,
            reused: item.reused
          }))
        }
      : null
  });
};
