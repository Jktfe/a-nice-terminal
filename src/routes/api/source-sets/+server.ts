/**
 * /api/source-sets — V2-server M5.1 slice 1: source-set governance CRUD.
 *
 * GET /api/source-sets
 *   Query: ?owner_org=<orgId>&scope_kind=org-wide|lens-specific
 *          &bound_lens_id=<lensId>&lifecycle=<csv-of-states>
 *   -> 200 { sourceSets: SourceSet[] }
 *   Visibility: admin-bearer sees every set; otherwise scoped to sets
 *   in orgs where caller is org-admin. Unauthenticated callers see []
 *   rather than 401 (parallel to lens listing pattern).
 *
 * POST /api/source-sets
 *   Body: {
 *     name, owner_org,
 *     description?, scope_kind?, bound_lens_id?, approvers?,
 *     review_cadence_ms?, initial_lifecycle_state?,
 *     created_by, actor_kind?, create_reason?
 *   }
 *   -> 201 { sourceSet: SourceSet }
 *   -> 400 invalid input
 *   -> 401 unauthenticated caller
 *   -> 403 caller not org-admin of owner_org (admin-bearer bypasses)
 *
 * Auth: F1 org-admin enforcement + F2 premium-tier guard on create.
 * Per the M5.1 acceptance: "non-org-admin sees 403 on Author endpoint".
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createSourceSet,
  listSourceSets,
  type SourceSetLifecycleState,
  type SourceSetScopeKind,
  type SourceSetActorKind
} from '$lib/server/sourceSetsStore';
import { isOrgAdmin, listOrgs } from '$lib/server/orgsStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { resolvePolicyActor } from '$lib/server/policyActor';
import { requireVerificationAuthorTier } from '$lib/server/featureGates';

const VALID_SCOPE_KINDS = new Set<SourceSetScopeKind>(['org-wide', 'lens-specific']);
const VALID_LIFECYCLE = new Set<SourceSetLifecycleState>([
  'proposed',
  'active',
  'deprecated',
  'withdrawn'
]);
const VALID_ACTOR_KINDS = new Set<SourceSetActorKind>(['human', 'agent', 'system']);

type ResolvedCaller =
  | { kind: 'admin'; handle: '@admin' }
  | { kind: 'identity'; handle: string }
  | { kind: 'anonymous' };

function resolveCaller(request: Request, body: unknown = null): ResolvedCaller {
  if (tryAdminBearer(request)) return { kind: 'admin', handle: '@admin' };
  const actor = resolvePolicyActor(request, body);
  if (actor) return { kind: 'identity', handle: actor.handle };
  return { kind: 'anonymous' };
}

function parseLifecycleCsv(raw: string | null): SourceSetLifecycleState[] | undefined {
  if (!raw) return undefined;
  const states = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SourceSetLifecycleState =>
      (VALID_LIFECYCLE as Set<string>).has(s)
    );
  return states.length > 0 ? states : undefined;
}

export const GET: RequestHandler = ({ request, url }) => {
  const caller = resolveCaller(request);
  const ownerOrgFilter = url.searchParams.get('owner_org') ?? undefined;
  const scopeKindRaw = url.searchParams.get('scope_kind');
  const scopeKind =
    scopeKindRaw && (VALID_SCOPE_KINDS as Set<string>).has(scopeKindRaw)
      ? (scopeKindRaw as SourceSetScopeKind)
      : undefined;
  const boundLensId = url.searchParams.get('bound_lens_id') ?? undefined;
  const lifecycleStates = parseLifecycleCsv(url.searchParams.get('lifecycle'));

  if (caller.kind === 'admin') {
    return json({
      sourceSets: listSourceSets({
        ownerOrg: ownerOrgFilter,
        scopeKind,
        boundLensId,
        lifecycleStates
      })
    });
  }

  if (caller.kind === 'anonymous') {
    return json({ sourceSets: [] });
  }

  // Identity-resolved caller: scope to orgs they admin.
  const allOrgs = listOrgs();
  const adminOrgIds = allOrgs
    .filter((org) => isOrgAdmin(org.id, caller.handle))
    .map((org) => org.id);
  if (adminOrgIds.length === 0) {
    return json({ sourceSets: [] });
  }
  if (ownerOrgFilter && !adminOrgIds.includes(ownerOrgFilter)) {
    return json({ sourceSets: [] });
  }
  const orgsToQuery = ownerOrgFilter ? [ownerOrgFilter] : adminOrgIds;
  const sets = orgsToQuery.flatMap((orgId) =>
    listSourceSets({
      ownerOrg: orgId,
      scopeKind,
      boundLensId,
      lifecycleStates
    })
  );
  return json({ sourceSets: sets });
};

export const POST: RequestHandler = async ({ request }) => {
  requireVerificationAuthorTier();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw error(400, 'JSON body required.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw error(400, 'JSON object body required.');
  }

  const name = body.name;
  const ownerOrg = body.owner_org;
  const createdBy = body.created_by;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw error(400, 'name (non-empty string) required.');
  }
  if (typeof ownerOrg !== 'string' || ownerOrg.trim().length === 0) {
    throw error(400, 'owner_org (non-empty string) required.');
  }
  if (typeof createdBy !== 'string' || createdBy.trim().length === 0) {
    throw error(400, 'created_by (non-empty string) required.');
  }

  const caller = resolveCaller(request, body);
  if (caller.kind === 'anonymous') {
    throw error(401, 'Identity required.');
  }
  if (caller.kind === 'identity') {
    if (!isOrgAdmin(ownerOrg, caller.handle)) {
      throw error(403, `Caller ${caller.handle} is not org-admin of ${ownerOrg}.`);
    }
    if (createdBy !== caller.handle) {
      throw error(
        400,
        `created_by must match caller identity (${caller.handle}).`
      );
    }
  }

  const scopeKindRaw = body.scope_kind;
  const scopeKind =
    typeof scopeKindRaw === 'string' && (VALID_SCOPE_KINDS as Set<string>).has(scopeKindRaw)
      ? (scopeKindRaw as SourceSetScopeKind)
      : undefined;
  if (scopeKindRaw !== undefined && scopeKind === undefined) {
    throw error(400, `scope_kind must be one of: ${[...VALID_SCOPE_KINDS].join(', ')}`);
  }

  const initialLifecycleRaw = body.initial_lifecycle_state;
  const initialLifecycleState =
    typeof initialLifecycleRaw === 'string' && (VALID_LIFECYCLE as Set<string>).has(initialLifecycleRaw)
      ? (initialLifecycleRaw as SourceSetLifecycleState)
      : undefined;
  if (initialLifecycleRaw !== undefined && initialLifecycleState === undefined) {
    throw error(
      400,
      `initial_lifecycle_state must be one of: ${[...VALID_LIFECYCLE].join(', ')}`
    );
  }

  const actorKindRaw = body.actor_kind;
  const actorKind =
    typeof actorKindRaw === 'string' && (VALID_ACTOR_KINDS as Set<string>).has(actorKindRaw)
      ? (actorKindRaw as SourceSetActorKind)
      : undefined;
  if (actorKindRaw !== undefined && actorKind === undefined) {
    throw error(400, `actor_kind must be one of: ${[...VALID_ACTOR_KINDS].join(', ')}`);
  }

  const approvers = Array.isArray(body.approvers)
    ? body.approvers.filter((h): h is string => typeof h === 'string')
    : undefined;
  if (body.approvers !== undefined && approvers === undefined) {
    throw error(400, 'approvers must be an array of strings.');
  }

  const reviewCadenceRaw = body.review_cadence_ms;
  let reviewCadenceMs: number | null | undefined;
  if (reviewCadenceRaw === undefined) {
    reviewCadenceMs = undefined;
  } else if (reviewCadenceRaw === null) {
    reviewCadenceMs = null;
  } else if (typeof reviewCadenceRaw === 'number' && Number.isFinite(reviewCadenceRaw)) {
    if (reviewCadenceRaw < 0) throw error(400, 'review_cadence_ms must be non-negative.');
    reviewCadenceMs = reviewCadenceRaw;
  } else {
    throw error(400, 'review_cadence_ms must be a finite number or null.');
  }

  try {
    const sourceSet = createSourceSet({
      id: typeof body.id === 'string' && body.id.trim().length > 0 ? body.id : undefined,
      name,
      description: typeof body.description === 'string' ? body.description : undefined,
      ownerOrg,
      scopeKind,
      boundLensId:
        typeof body.bound_lens_id === 'string' && body.bound_lens_id.trim().length > 0
          ? body.bound_lens_id
          : undefined,
      approvers,
      reviewCadenceMs,
      initialLifecycleState,
      createdBy,
      actorKind,
      createReason: typeof body.create_reason === 'string' ? body.create_reason : undefined
    });
    return json({ sourceSet }, { status: 201 });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw error(400, `createSourceSet failed: ${msg}`);
  }
};
