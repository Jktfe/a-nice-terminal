import type { RequestHandler } from './$types';
import { manifestData } from '$lib/cli-manifest/manifest';
import { renderManifestAsMarkdown } from '$lib/cli-manifest/markdownRender';

export const GET: RequestHandler = async () => {
  const body = renderManifestAsMarkdown(manifestData);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
};
