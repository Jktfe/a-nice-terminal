import type { PageLoad } from './$types';

export type VaultArchive = {
  roomId: string;
  name: string;
  summary: string;
  archivedAtMs: number | null;
  whoCreatedIt: string;
  messageCount: number;
  hasMineableContent: boolean;
};

export const load: PageLoad = async ({ fetch }) => {
  try {
    const response = await fetch('/api/vault');
    if (!response.ok) {
      return { archives: [] as VaultArchive[], fetchFailed: true };
    }
    const body = (await response.json()) as { archives: VaultArchive[] };
    return { archives: body.archives ?? [], fetchFailed: false };
  } catch {
    return { archives: [] as VaultArchive[], fetchFailed: true };
  }
};
