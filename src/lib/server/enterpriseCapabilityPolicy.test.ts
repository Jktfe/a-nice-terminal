import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import {
  grantTool,
  registerTool,
  resetToolsCatalogForTests,
  revokeToolGrant
} from './toolsCatalogStore';
import {
  evaluateRawPtyCapability,
  RAW_PTY_TOOL_SLUG
} from './enterpriseCapabilityPolicy';

describe('enterpriseCapabilityPolicy', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
    resetToolsCatalogForTests();
  });

  it('denies raw PTY when the capability tool is not registered', () => {
    const decision = evaluateRawPtyCapability({
      granteeHandle: '@codexe',
      roomId: 'room-a',
      nowMs: 1_000
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'capability_tool_not_registered',
      requiredToolSlug: RAW_PTY_TOOL_SLUG
    });
  });

  it('denies raw PTY when the tool exists but the actor has no active grant', () => {
    registerTool({
      toolSlug: RAW_PTY_TOOL_SLUG,
      kind: 'bridge',
      name: 'Raw PTY shell'
    });

    const decision = evaluateRawPtyCapability({
      granteeHandle: '@codexe',
      roomId: 'room-a',
      nowMs: 1_000
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'missing_active_capability_grant',
      requiredToolSlug: RAW_PTY_TOOL_SLUG
    });
  });

  it('allows raw PTY with an active room-scoped grant', () => {
    const tool = registerTool({
      toolSlug: RAW_PTY_TOOL_SLUG,
      kind: 'bridge',
      name: 'Raw PTY shell'
    });
    const grant = grantTool({
      granteeHandle: '@codexe',
      toolId: tool.toolId,
      scopeKind: 'room',
      scopeId: 'room-a',
      grantedByHandle: '@you',
      nowMs: 1_000
    });

    const decision = evaluateRawPtyCapability({
      granteeHandle: 'codexe',
      roomId: 'room-a',
      nowMs: 2_000
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: 'active_capability_grant',
      grantId: grant.grantId,
      scopeKind: 'room',
      scopeId: 'room-a'
    });
  });

  it('ignores revoked and expired grants', () => {
    const tool = registerTool({
      toolSlug: RAW_PTY_TOOL_SLUG,
      kind: 'bridge',
      name: 'Raw PTY shell'
    });
    grantTool({
      granteeHandle: '@codexe',
      toolId: tool.toolId,
      scopeKind: 'global',
      grantedByHandle: '@you',
      expiresAtMs: 1_500,
      nowMs: 1_000
    });
    grantTool({
      granteeHandle: '@codexe',
      toolId: tool.toolId,
      scopeKind: 'room',
      scopeId: 'room-a',
      grantedByHandle: '@you',
      nowMs: 1_100
    });
    revokeToolGrant({
      granteeHandle: '@codexe',
      toolId: tool.toolId,
      scopeKind: 'room',
      scopeId: 'room-a',
      nowMs: 1_200
    });

    const decision = evaluateRawPtyCapability({
      granteeHandle: '@codexe',
      roomId: 'room-a',
      nowMs: 2_000
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: 'missing_active_capability_grant'
    });
  });
});
