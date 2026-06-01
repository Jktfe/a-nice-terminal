import {
  findToolBySlug,
  lookupActiveGrant,
  type ToolGrantScopeKind
} from './toolsCatalogStore';

export const RAW_PTY_TOOL_SLUG = 'raw-pty-shell';

export type EnterpriseCapabilityDecision =
  | {
      allowed: true;
      reason: 'active_capability_grant';
      requiredToolSlug: string;
      grantId: string;
      scopeKind: ToolGrantScopeKind;
      scopeId: string | null;
    }
  | {
      allowed: false;
      reason: 'capability_tool_not_registered' | 'missing_active_capability_grant';
      requiredToolSlug: string;
    };

export type RawPtyCapabilityInput = {
  granteeHandle: string;
  sessionId?: string | null;
  roomId?: string | null;
  orgId?: string | null;
  nowMs?: number;
};

type CandidateScope = {
  scopeKind: ToolGrantScopeKind;
  scopeId?: string;
};

function candidateScopes(input: RawPtyCapabilityInput): CandidateScope[] {
  const scopes: CandidateScope[] = [];
  if (input.sessionId) scopes.push({ scopeKind: 'session', scopeId: input.sessionId });
  if (input.roomId) scopes.push({ scopeKind: 'room', scopeId: input.roomId });
  if (input.orgId) scopes.push({ scopeKind: 'org', scopeId: input.orgId });
  scopes.push({ scopeKind: 'global' });
  return scopes;
}

export function evaluateRawPtyCapability(
  input: RawPtyCapabilityInput
): EnterpriseCapabilityDecision {
  const tool = findToolBySlug(RAW_PTY_TOOL_SLUG);
  if (!tool) {
    return {
      allowed: false,
      reason: 'capability_tool_not_registered',
      requiredToolSlug: RAW_PTY_TOOL_SLUG
    };
  }

  for (const scope of candidateScopes(input)) {
    const grant = lookupActiveGrant(
      {
        granteeHandle: input.granteeHandle,
        toolId: tool.toolId,
        scopeKind: scope.scopeKind,
        scopeId: scope.scopeId
      },
      input.nowMs
    );
    if (grant) {
      return {
        allowed: true,
        reason: 'active_capability_grant',
        requiredToolSlug: RAW_PTY_TOOL_SLUG,
        grantId: grant.grantId,
        scopeKind: grant.scopeKind,
        scopeId: grant.scopeId
      };
    }
  }

  return {
    allowed: false,
    reason: 'missing_active_capability_grant',
    requiredToolSlug: RAW_PTY_TOOL_SLUG
  };
}
