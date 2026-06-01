import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import type { Policy } from '$lib/server/policyStore';

export const load: PageLoad = async ({ fetch, params }) => {
  const [policyResponse, listResponse] = await Promise.all([
    fetch(`/api/policies/${encodeURIComponent(params.slug)}`),
    fetch('/api/policies?mine=1')
  ]);
  if (!policyResponse.ok) {
    if (policyResponse.status === 404) throw error(404, 'Policy not found.');
    if (policyResponse.status === 403) throw error(403, 'Policy is private.');
    throw error(policyResponse.status, `Could not load policy (${policyResponse.status}).`);
  }
  const { policy } = (await policyResponse.json()) as { policy: Policy };
  let myHandle: string | null = null;
  let verificationUxEnabled = false;
  if (listResponse.ok) {
    const body = (await listResponse.json()) as { myHandle: string | null; verificationUxEnabled: boolean };
    myHandle = body.myHandle;
    verificationUxEnabled = body.verificationUxEnabled;
  }
  return { policy, myHandle, verificationUxEnabled };
};
