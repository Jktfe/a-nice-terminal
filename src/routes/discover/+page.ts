import type { PageLoad } from './$types';
import { manifestData, type CliManifestVerb } from '$lib/cli-manifest/manifest';

export type DiscoverPageData = {
  verbs: CliManifestVerb[];
  totalCount: number;
  generatedAt: string;
};

export const load: PageLoad = async () => {
  return {
    verbs: manifestData,
    totalCount: manifestData.length,
    generatedAt: new Date().toISOString()
  };
};
