import type { PageLoad } from './$types';

// Public invite preview — SSR-friendly so the room label paints on first
// frame without a client round-trip. Summary endpoint is no-auth (the
// invite id IS the capability) so a universal load is safe here. A bad /
// revoked id resolves to summary:null → page renders the empty state
// (never crashes, never leaks why).
export const load: PageLoad = async ({ params, fetch }) => {
  const inviteId = params.inviteId;
  try {
    const res = await fetch(`/api/chat-invites/${encodeURIComponent(inviteId)}/summary`);
    if (!res.ok) return { inviteId, summary: null };
    const summary = (await res.json()) as {
      inviteId: string;
      roomId: string;
      label: string;
      kindsAllowed: string[];
      revoked: boolean;
    };
    return { inviteId, summary };
  } catch {
    return { inviteId, summary: null };
  }
};
