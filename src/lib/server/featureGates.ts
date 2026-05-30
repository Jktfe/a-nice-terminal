/**
 * featureGates.ts — tier-aware feature discovery.
 *
 * Reads ANT_TIER env at import time. Returns static feature map.
 * No DB lookup, no runtime negotiation, no commercial enforcement.
 * This is Gate 1 (discovery only). Gate 2 (enforcement) is deferred.
 */

import { error } from '@sveltejs/kit';

export type Tier = 'oss' | 'native' | 'enterprise';

function getEnvTier(): Tier {
  const raw = process.env.ANT_TIER?.trim().toLowerCase() ?? '';
  if (raw === 'native') return 'native';
  if (raw === 'enterprise') return 'enterprise';
  return 'oss';
}

export const CURRENT_TIER: Tier = getEnvTier();

// Hardcoded server version — bump manually on release
export const SERVER_VERSION = '4.2.1';
export const BUILD_CHANNEL = 'stable';

const OSS_FEATURES = [
  'chat',
  'rooms',
  'plans',
  'tasks',
  'terminals',
  'cli_manifest',
  'mcp_index',
  'diagnostics',
  'consent_grants',
  'archive_recovery',
  'file_refs',
  'search',
  'hooks',
  'memory',
  'interviews',
  'decks',
  'sheets',
  'tunnels',
  'skills',
  'grants',
];

const NATIVE_FEATURES = [
  'chair',
  'remote_antchat',
  'voice',
  'push_notifications',
  'qr_pairing',
  'multi_machine_sync',
  'menu_bar',
  'dock_badge',
  'spotlight',
  'keychain',
  'share_extension',
  'watch_companion',
  'deep_linking',
  'auto_update',
];

const ENTERPRISE_FEATURES = [
  'sso',
  'audit_retention',
  'tenant_isolation',
  'policy_controls',
  'hosted_llm_backend',
  'compliance_export',
];

export function getFeaturesForTier(tier: Tier): {
  oss: string[];
  native: string[];
  enterprise: string[];
} {
  return {
    oss: OSS_FEATURES,
    native: tier === 'native' || tier === 'enterprise' ? NATIVE_FEATURES : [],
    enterprise: tier === 'enterprise' ? ENTERPRISE_FEATURES : [],
  };
}

export function getFeatureFlagsForTier(tier: Tier): Record<string, boolean> {
  const flags: Record<string, boolean> = {
    chair_api: true,
    chair_ux: tier !== 'oss',
    remote_join: tier !== 'oss',
    voice: tier !== 'oss',
    push: tier !== 'oss',
    qr_pairing: tier !== 'oss',
    multi_machine_sync: tier !== 'oss',
    auto_update: tier !== 'oss',
    sso: tier === 'enterprise',
    tenant_isolation: tier === 'enterprise',
    policy_controls: tier === 'enterprise',
    audit_retention: tier === 'enterprise',
    hosted_llm_backend: tier === 'enterprise',
    // Phase A.5 verification subsystem (JWPK 2026-05-17): rendering layer
    // (Univer) stays OSS; authoring + applying verification policies is
    // premium (chair pattern — api always present so self-hosters can
    // wire it, ux gated on paid tier).
    verification_api: true,
    verification_ux: tier !== 'oss',
    // F2 (2026-05-28): server-authoritative author gate. OSS tier supports
    // Browse / Apply / Run-Lens / Audit; Author actions (create/edit/
    // deprecate tags, create/edit lenses, execute skills) require premium.
    // Distinct from verification_ux which gates Trust-chip rendering.
    verification_author: tier !== 'oss',
    // Premium "Bring in App" feature (JWPK msg_a0s51ioct6 2026-05-25): one-tap
    // launchers for Claude Desktop / Claude Mobile / ChatGPT / Codex Desktop /
    // Gemini with room context. API always present so OSS self-hosters can
    // wire it; UX gated on paid tier. Spec at
    // docs/research/bring-in-app-spec-2026-05-25.md.
    bring_in_app_api: true,
    bring_in_app_ux: tier !== 'oss',
  };
  return flags;
}

export function getLimitsForTier(tier: Tier): {
  maxRooms: number | null;
  maxTerminals: number | null;
  maxAgentsPerRoom: number | null;
  messageRetentionDays: number;
} {
  if (tier === 'enterprise') {
    return {
      maxRooms: null,
      maxTerminals: null,
      maxAgentsPerRoom: null,
      messageRetentionDays: 365,
    };
  }
  if (tier === 'native') {
    return {
      maxRooms: 50,
      maxTerminals: 20,
      maxAgentsPerRoom: 10,
      messageRetentionDays: 90,
    };
  }
  // oss
  return {
    maxRooms: 10,
    maxTerminals: 5,
    maxAgentsPerRoom: 3,
    messageRetentionDays: 30,
  };
}

export function getMigrationCompatibility() {
  return {
    minClientVersion: '4.0.0',
    deprecatedFeatures: [] as string[],
    breakingChanges: [] as string[],
  };
}

/**
 * F2 gate: throws 403 if the current tier does not include verification-author
 * privileges. Independent of admin-bearer (admin-bearer = who; tier = what).
 * Call AFTER the admin-bearer check in Author endpoints.
 */
export function requireVerificationAuthorTier(): void {
  const flags = getFeatureFlagsForTier(CURRENT_TIER);
  if (!flags.verification_author) {
    throw error(
      403,
      'Verification authoring requires premium tier. OSS tier supports Browse / Apply / Run-Lens / Audit; upgrade to Author tags + lenses.'
    );
  }
}

export function getBranding(): {
  productName: string;
  upgradeCta: string | null;
} {
  if (CURRENT_TIER === 'enterprise') {
    return { productName: 'ANT Enterprise', upgradeCta: null };
  }
  if (CURRENT_TIER === 'native') {
    return { productName: 'ANT Pro', upgradeCta: 'Upgrade to Enterprise' };
  }
  return { productName: 'ANT', upgradeCta: 'Upgrade to Pro' };
}
