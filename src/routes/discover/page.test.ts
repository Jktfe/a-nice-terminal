/**
 * SSR rendering tests for the /discover route.
 *
 * Validates that the page renders manifestData accurately and that the
 * 2026-05-15 redesign load-bearing surfaces (toolbar with search + status
 * filter chips, anchor-nav strip, per-primaryVerb grouping, per-card
 * status dot, copy button per source_ref, v3 GitHub linkify) are present.
 *
 * Counts are derived from manifestData so manifest growth doesn't break
 * tests.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import {
  manifestData,
  listAvailableVerbs,
  listNeedsWrapperVerbs,
  listPlannedVerbs
} from '$lib/cli-manifest/manifest';
import { load, type DiscoverPageData } from './+page';
import DiscoverPage from './+page.svelte';

function decodeHtml(html: string): string {
  return html
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

async function loadData(): Promise<DiscoverPageData> {
  return (await load({} as Parameters<typeof load>[0])) as DiscoverPageData;
}

async function renderDiscover() {
  const data = await loadData();
  const result = render(DiscoverPage, { props: { data } });
  return { ...result, body: decodeHtml(result.body) };
}

describe('discover page load', () => {
  it('returns the full flat manifest plus a total count', async () => {
    const data = await loadData();
    expect(data.totalCount).toBe(manifestData.length);
    expect(data.verbs.length).toBe(manifestData.length);
  });

  it('returns a generatedAt ISO timestamp', async () => {
    const data = await loadData();
    expect(typeof data.generatedAt).toBe('string');
    expect(() => new Date(data.generatedAt)).not.toThrow();
    expect(Number.isFinite(new Date(data.generatedAt).getTime())).toBe(true);
  });
});

describe('discover page SSR', () => {
  it('renders the page heading', async () => {
    const { body } = await renderDiscover();
    expect(body).toContain('ant CLI verbs');
  });

  it('renders a search input with a visible label', async () => {
    const { body } = await renderDiscover();
    expect(body).toContain('id="discover-search"');
    expect(body).toContain('for="discover-search"');
  });

  it('renders status filter chips with derived counts', async () => {
    const { body } = await renderDiscover();
    expect(body).toContain('aria-label="Status filter"');
    expect(body).toContain('Available');
    expect(body).toContain('Needs wrapper');
    expect(body).toContain('Planned');
    // counts appear inside <span class="chip-count">N</span>
    expect(body).toContain(`>${listAvailableVerbs().length}<`);
    expect(body).toContain(`>${listNeedsWrapperVerbs().length}<`);
    expect(body).toContain(`>${listPlannedVerbs().length}<`);
  });

  it('renders the result counter showing N of total', async () => {
    const { body } = await renderDiscover();
    expect(body).toContain(`of ${manifestData.length}`);
  });

  it('renders every verb id as a data-verb-id attribute', async () => {
    const { body } = await renderDiscover();
    for (const verb of manifestData) {
      expect(body, `verb ${verb.id} not rendered`).toContain(`data-verb-id="${verb.id}"`);
    }
  });

  it('renders every verb usage and summary text', async () => {
    const { body } = await renderDiscover();
    for (const verb of manifestData) {
      expect(body, `usage missing for ${verb.id}`).toContain(verb.usage);
      expect(body, `summary missing for ${verb.id}`).toContain(verb.summary);
    }
  });

  it('renders canonical examples for available + needs-wrapper verbs', async () => {
    const { body } = await renderDiscover();
    for (const verb of manifestData) {
      if (verb.canonical_example) {
        expect(body, `example missing for ${verb.id}`).toContain(verb.canonical_example);
      }
    }
  });

  it('renders a status-coded data-status attribute per verb', async () => {
    const { body } = await renderDiscover();
    for (const verb of manifestData) {
      expect(body, `status attr missing for ${verb.id}`).toContain(`data-status="${verb.status}"`);
    }
  });

  it('renders per-primaryVerb group sections with verb counts', async () => {
    const { body } = await renderDiscover();
    const distinctPrimary = new Set(manifestData.map((v) => v.primaryVerb));
    expect(distinctPrimary.size).toBeGreaterThan(0);
    for (const primaryVerb of distinctPrimary) {
      expect(body, `group section missing for ${primaryVerb}`).toContain(
        `id="verb-group-${primaryVerb}"`
      );
      const count = manifestData.filter((v) => v.primaryVerb === primaryVerb).length;
      expect(body, `group count missing for ${primaryVerb}`).toContain(`(${count})`);
    }
  });

  it('renders the anchor-nav strip with one button per group', async () => {
    const { body } = await renderDiscover();
    expect(body).toContain('aria-label="Verb groups"');
  });

  it('renders status-show-v2 as available with rich agent status surface (M3.4a-v2 shipped)', async () => {
    const { body } = await renderDiscover();
    expect(body).toContain('data-verb-id="status-show-v2"');
    expect(body.toLowerCase()).toContain('rich agent status');
  });

  it('renders source_ref strings for traceability', async () => {
    const { body } = await renderDiscover();
    for (const verb of manifestData) {
      expect(body, `source_ref missing for ${verb.id}`).toContain(verb.source_ref);
    }
  });

  it('renders a copy-source button per verb', async () => {
    const { body } = await renderDiscover();
    for (const verb of manifestData) {
      expect(body, `copy button missing for ${verb.id}`).toContain(
        `aria-label="Copy source ref for ${verb.id}"`
      );
    }
  });

  it('renders flag summaries for verbs that have flags', async () => {
    const { body } = await renderDiscover();
    for (const verb of listAvailableVerbs()) {
      if (verb.flags.length === 0) continue;
      const firstFlag = verb.flags[0];
      expect(body, `flag --${firstFlag.name} missing for ${verb.id}`).toContain(
        `--${firstFlag.name}`
      );
    }
  });

  it('renders v3-repo source_ref as a clickable GitHub link with #L anchor', async () => {
    const { body } = await renderDiscover();
    const v3Verbs = manifestData.filter((v) => v.repo === 'v3');
    expect(
      v3Verbs.length,
      'manifest must have at least one v3 verb to validate link shape'
    ).toBeGreaterThan(0);
    for (const verb of v3Verbs) {
      const [fileSlug, rangeSlug] = verb.source_ref.split(':');
      const firstRange = (rangeSlug ?? '').split(',')[0];
      const [start, end] = firstRange.split('-');
      const anchor = end ? `#L${start}-L${end}` : `#L${start}`;
      const expectedHref = `https://github.com/Jktfe/a-nice-terminal/blob/main/${fileSlug}${anchor}`;
      expect(body, `v3 verb ${verb.id} missing href ${expectedHref}`).toContain(
        `href="${expectedHref}"`
      );
      expect(body, `v3 verb ${verb.id} link missing rel noopener`).toContain(
        'rel="noopener noreferrer"'
      );
    }
  });

  it('does NOT linkify source_ref for fresh-ant or delivery-plan repos (plain code + copy only)', async () => {
    const { body } = await renderDiscover();
    const nonLinkedVerbs = manifestData.filter((v) => (v.repo ?? 'fresh-ant') !== 'v3');
    for (const verb of nonLinkedVerbs) {
      const hrefIntoOtherRepo = `blob/main/${verb.source_ref.split(':')[0]}`;
      expect(body, `non-v3 verb ${verb.id} unexpectedly linkified`).not.toContain(
        `href="https://github.com/Jktfe/${hrefIntoOtherRepo}"`
      );
    }
  });
});
