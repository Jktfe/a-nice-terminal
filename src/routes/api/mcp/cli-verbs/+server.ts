/**
 * MCP thin-index — read-only discovery of CLI verbs.
 *
 * Deliberate design choice: this MCP surface is a thin index, not an
 * execution proxy. Agents discover available CLI verbs here but execute
 * them through `ant` CLI invocations. CLI-first by design.
 *
 * GET /api/mcp/cli-verbs
 *   → MCP resources/list response with all manifest verbs as entries.
 *
 * GET /api/mcp/cli-verbs?verb=<id>
 *   → Single verb detail as MCP resource.
 *
 * Source of truth: src/lib/cli-manifest/manifest.ts
 *
 * Phase 1 / Lane C / evolveantdeep
 */
import { json } from '@sveltejs/kit';
import { manifestData, type CliManifestVerb } from '$lib/cli-manifest/manifest';

const MANIFEST_RESOURCE_BASE = 'ant://cli-verbs';

type McpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

type McpResourceContent = {
  uri: string;
  mimeType: string;
  text: string;
};

function verbToResource(verb: CliManifestVerb): McpResource {
  return {
    uri: `${MANIFEST_RESOURCE_BASE}/${verb.id}`,
    name: verb.usage,
    description: verb.summary,
    mimeType: 'application/json'
  };
}

function verbToContent(verb: CliManifestVerb): McpResourceContent {
  const payload = {
    id: verb.id,
    primaryVerb: verb.primaryVerb,
    secondaryVerb: verb.secondaryVerb ?? null,
    usage: verb.usage,
    summary: verb.summary,
    flags: verb.flags.map((f) => ({
      name: f.name,
      type: f.type,
      default: f.default ?? null,
      constraint: f.constraint ?? null,
      summary: f.summary
    })),
    canonical_example: verb.canonical_example,
    source_ref: verb.source_ref,
    repo: verb.repo ?? 'fresh-ant',
    status: verb.status,
    since_version: verb.since_version ?? null
  };
  return {
    uri: `${MANIFEST_RESOURCE_BASE}/${verb.id}`,
    mimeType: 'application/json',
    text: JSON.stringify(payload, null, 2)
  };
}

export const GET = async ({ url }: { url: URL }) => {
  const verbId = url.searchParams.get('verb');

  // Single-verb detail
  if (verbId) {
    const verb = manifestData.find((v) => v.id === verbId);
    if (!verb) {
      return json({ error: `verb not found: ${verbId}` }, { status: 404 });
    }
    return json({
      contents: [verbToContent(verb)]
    });
  }

  // Full resource list
  const resources: McpResource[] = manifestData.map(verbToResource);

  // Also include a summary resource for quick token-efficient overview
  const summaryResource: McpResource = {
    uri: `${MANIFEST_RESOURCE_BASE}/_summary`,
    name: 'CLI verb summary',
    description: `All ${manifestData.length} CLI verb IDs. Use individual URIs for detail.`,
    mimeType: 'application/json'
  };

  return json({
    resources: [summaryResource, ...resources]
  });
};
