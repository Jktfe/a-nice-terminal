// Tests for the manifest → markdown renderer.
// Derive expectations from manifestData per gate guidance.

import { describe, expect, it } from 'vitest';
import {
  manifestData,
  listAvailableVerbs,
  listNeedsWrapperVerbs,
  listPlannedVerbs
} from './manifest';
import { renderManifestAsMarkdown, sourceRefMarkdownLink } from './markdownRender';

const GENERATED_AT = '2026-05-13T00:00:00.000Z';

function rendered(): string {
  return renderManifestAsMarkdown(manifestData, GENERATED_AT);
}

describe('renderManifestAsMarkdown — header', () => {
  it('starts with the H1 title', () => {
    expect(rendered().split('\n')[0]).toBe('# ant CLI verbs');
  });

  it('includes the generatedAt timestamp', () => {
    expect(rendered()).toContain(GENERATED_AT);
  });

  it('links to the live /discover route', () => {
    expect(rendered()).toContain('[`/discover`](/discover)');
  });

  it('reports total + per-status counts derived from manifest', () => {
    const out = rendered();
    expect(out).toContain(`**Total verbs:** ${manifestData.length}`);
    expect(out).toContain(`**Available:** ${listAvailableVerbs().length}`);
    expect(out).toContain(`**Needs wrapper:** ${listNeedsWrapperVerbs().length}`);
    expect(out).toContain(`**Planned:** ${listPlannedVerbs().length}`);
  });
});

describe('renderManifestAsMarkdown — sections', () => {
  it('renders Available section with the right verb count in heading', () => {
    expect(rendered()).toContain(`## Available now (${listAvailableVerbs().length})`);
  });

  it('renders Needs wrapper section when count > 0; suppresses header when zero', () => {
    // renderSection returns '' for zero-entry status groups + the sections
    // array filters them out, so an empty Needs wrapper group has NO header
    // in the output. Once the manifest has a needs-wrapper entry again
    // (e.g. a future planned-but-server-capable verb), the header reappears.
    if (listNeedsWrapperVerbs().length > 0) {
      expect(rendered()).toContain(`## Needs wrapper (${listNeedsWrapperVerbs().length})`);
    } else {
      expect(rendered()).not.toContain('## Needs wrapper');
    }
  });

  it('renders Planned section when planned verbs exist (skipped when none)', () => {
    const plannedCount = listPlannedVerbs().length;
    if (plannedCount === 0) {
      // 2026-05-16: every planned verb has shipped — renderer correctly
      // omits the section when verbs.length === 0 (see renderSection in
      // markdownRender.ts). Test simply asserts the rendering doesn't
      // include a stale planned header.
      expect(rendered()).not.toContain('## Planned');
      return;
    }
    expect(rendered()).toContain(`## Planned (${plannedCount})`);
  });
});

describe('renderManifestAsMarkdown — verb entries', () => {
  it('renders an H3 anchor + usage for every verb', () => {
    const out = rendered();
    for (const verb of manifestData) {
      expect(out, `verb ${verb.id} missing H3 anchor`).toContain(`<a id="verb-${verb.id}"></a>`);
      expect(out, `verb ${verb.id} missing usage`).toContain(verb.usage);
    }
  });

  it('renders summary text for every verb', () => {
    const out = rendered();
    for (const verb of manifestData) {
      expect(out, `verb ${verb.id} missing summary`).toContain(verb.summary);
    }
  });

  it('renders canonical_example with Example: prefix', () => {
    const out = rendered();
    for (const verb of manifestData) {
      expect(out, `verb ${verb.id} missing example`).toContain(`**Example:** \`${verb.canonical_example}\``);
    }
  });

  it('renders a flag table for verbs that have flags', () => {
    const out = rendered();
    for (const verb of manifestData) {
      if (verb.flags.length === 0) continue;
      expect(out, `verb ${verb.id} missing flag table header`).toContain('| Flag | Type | Default | Constraint | Summary |');
      for (const flag of verb.flags) {
        expect(out, `verb ${verb.id} flag --${flag.name} missing`).toContain(`\`--${flag.name}\``);
      }
    }
  });

  it('renders Source: line for every verb', () => {
    const out = rendered();
    for (const verb of manifestData) {
      expect(out, `verb ${verb.id} missing Source line`).toContain(`**Source:**`);
    }
  });
});

describe('sourceRefMarkdownLink', () => {
  it('emits a markdown link for v3 verbs with #L anchor', () => {
    const v3 = manifestData.find((v) => v.repo === 'v3');
    expect(v3, 'manifest must contain at least one v3 verb').toBeDefined();
    if (!v3) return;
    const link = sourceRefMarkdownLink(v3);
    expect(link.startsWith('[')).toBe(true);
    expect(link).toContain('https://github.com/Jktfe/a-nice-terminal/blob/main/');
    expect(link).toContain('#L');
  });

  it('emits plain inline code for fresh-ant verbs (remote unconfirmed)', () => {
    const freshAnt = manifestData.find((v) => (v.repo ?? 'fresh-ant') === 'fresh-ant');
    expect(freshAnt, 'manifest must contain at least one fresh-ant verb').toBeDefined();
    if (!freshAnt) return;
    const link = sourceRefMarkdownLink(freshAnt);
    expect(link.startsWith('[')).toBe(false);
    expect(link).toBe(`\`${freshAnt.source_ref}\``);
  });

  it('emits plain inline code for delivery-plan verbs (skipped when manifest has none)', () => {
    // After the 2026-05-16 sweep, every delivery-plan-tagged planned verb
    // was shipped and re-classified as fresh-ant `av(...)`. We keep the
    // sourceRefMarkdownLink delivery-plan code path tested via a
    // synthetic verb so the renderer's branch is still exercised.
    const dp = manifestData.find((v) => v.repo === 'delivery-plan');
    if (!dp) {
      const synthetic = {
        id: 'synthetic-dp', primaryVerb: 'syn', usage: 'syn', summary: 'syn',
        flags: [], canonical_example: 'ant syn', source_ref: 'ANT-Open-Slide/x.md:1',
        repo: 'delivery-plan' as const, status: 'planned' as const
      };
      expect(sourceRefMarkdownLink(synthetic)).toBe(`\`${synthetic.source_ref}\``);
      return;
    }
    expect(sourceRefMarkdownLink(dp)).toBe(`\`${dp.source_ref}\``);
  });
});

describe('renderManifestAsMarkdown — markdown table escaping', () => {
  it('escapes pipe characters in flag constraint cells', () => {
    const verb = {
      id: 'pipe-test', primaryVerb: 'pipe', usage: 'pipe test', summary: 'pipe test',
      flags: [{ name: 'mode', type: 'enum' as const, constraint: 'brainstorm|heads-down|closed', summary: 'pipe in constraint' }],
      canonical_example: 'ant pipe test', source_ref: 'x:1', status: 'available' as const
    };
    const out = renderManifestAsMarkdown([verb], GENERATED_AT);
    expect(out).toContain('brainstorm\\|heads-down\\|closed');
    expect(out).not.toContain('| brainstorm|heads-down|closed |');
  });

  it('escapes pipe in summary cells', () => {
    const verb = {
      id: 'pipe2', primaryVerb: 'pipe2', usage: 'pipe2', summary: 'pipe2',
      flags: [{ name: 'm', type: 'string' as const, summary: 'one | two' }],
      canonical_example: 'ant pipe2', source_ref: 'x:1', status: 'available' as const
    };
    const out = renderManifestAsMarkdown([verb], GENERATED_AT);
    expect(out).toContain('one \\| two');
  });

  it('collapses newlines in cells so the row stays single-line', () => {
    const verb = {
      id: 'nl', primaryVerb: 'nl', usage: 'nl', summary: 'nl',
      flags: [{ name: 'x', type: 'string' as const, summary: 'first\nsecond' }],
      canonical_example: 'ant nl', source_ref: 'x:1', status: 'available' as const
    };
    const out = renderManifestAsMarkdown([verb], GENERATED_AT);
    expect(out).toContain('first second');
    expect(out).not.toMatch(/\| first\nsecond/);
  });
});

describe('renderManifestAsMarkdown — repo metadata', () => {
  it('renders **Repo:** line for verbs with explicit repo', () => {
    const out = rendered();
    for (const verb of manifestData) {
      if (!verb.repo) continue;
      expect(out, `verb ${verb.id} missing **Repo:** ${verb.repo}`).toContain(`**Repo:** \`${verb.repo}\``);
    }
  });
});
