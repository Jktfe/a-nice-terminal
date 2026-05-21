import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { Policy, PolicyAuditEntry } from '$lib/server/policyStore';
import type { Tier } from '$lib/server/featureGates';

export const load: PageLoad = async ({ fetch, params }) => {
  const [policyResponse, auditResponse, listResponse] = await Promise.all([
    fetch(`/api/policies/${encodeURIComponent(params.slug)}`),
    fetch(`/api/policies/${encodeURIComponent(params.slug)}/audit`),
    fetch('/api/policies?mine=1')
  ]);
  if (!policyResponse.ok) {
    if (policyResponse.status === 404) throw error(404, 'Policy not found.');
    if (policyResponse.status === 403) throw error(403, 'Policy is private.');
    throw error(policyResponse.status, `Could not load policy (${policyResponse.status}).`);
  }
  const { policy } = (await policyResponse.json()) as { policy: Policy };
  const audit: PolicyAuditEntry[] = auditResponse.ok
    ? ((await auditResponse.json()) as { audit: PolicyAuditEntry[] }).audit
    : [];
  // listResponse gives us the caller's handle + tier without a second
  // identity round-trip
  let myHandle: string | null = null;
  let tier: Tier = 'oss';
  let verificationUxEnabled = false;
  if (listResponse.ok) {
    const body = (await listResponse.json()) as {
      myHandle: string | null;
      tier: Tier;
      verificationUxEnabled: boolean;
    };
    myHandle = body.myHandle;
    tier = body.tier;
    verificationUxEnabled = body.verificationUxEnabled;
  }
  return { policy, audit, myHandle, tier, verificationUxEnabled };
};
