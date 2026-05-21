import type { PageLoad } from './$types';
import type { Policy } from '$lib/server/policyStore';
import type { Tier } from '$lib/server/featureGates';

export const load: PageLoad = async ({ fetch, url }) => {
  const mineOnly = url.searchParams.get('mine') === '1';
  const apiUrl = mineOnly ? '/api/policies?mine=1' : '/api/policies';
  const response = await fetch(apiUrl);
  if (!response.ok) {
    return {
      policies: [] as Policy[],
      myHandle: null as string | null,
      tier: 'oss' as Tier,
      verificationUxEnabled: false,
      mineOnly,
      serverFailed: true as const
    };
  }
  const body = (await response.json()) as {
    policies: Policy[];
    myHandle: string | null;
    tier: Tier;
    verificationUxEnabled: boolean;
  };
  return {
    policies: body.policies,
    myHandle: body.myHandle,
    tier: body.tier,
    verificationUxEnabled: body.verificationUxEnabled,
    mineOnly,
    serverFailed: false as const
  };
};
