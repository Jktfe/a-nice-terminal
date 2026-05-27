import type { PageLoad } from './$types';
import type { Tier } from '$lib/server/featureGates';

type Lens = {
  id: string;
  name: string;
  description: string | null;
  lensKind: string;
  scope: string;
  scopeId: string;
  rules: unknown;
  createdBy: string;
  createdAtMs: number;
  updatedAtMs: number;
  archivedAtMs: number | null;
};

export const load: PageLoad = async ({ fetch }) => {
  const [lensesResponse, capabilitiesResponse] = await Promise.all([
    fetch('/api/verification/lenses'),
    fetch('/api/capabilities').catch(() => null)
  ]);

  const lensesBody = lensesResponse.ok
    ? await lensesResponse.json() as { lenses: Lens[] }
    : { lenses: [] as Lens[] };
  const capabilitiesBody = capabilitiesResponse?.ok
    ? await capabilitiesResponse.json() as { tier: Tier; featureFlags?: Record<string, boolean> }
    : { tier: 'oss' as Tier, featureFlags: {} };

  return {
    lenses: lensesBody.lenses,
    lensesLoadFailed: !lensesResponse.ok,
    tier: capabilitiesBody.tier,
    verificationUxEnabled: capabilitiesBody.featureFlags?.verification_ux === true
  };
};
