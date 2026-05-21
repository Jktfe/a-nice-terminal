/**
 * Markdown renderer for the CLI manifest.
 *
 * Drives both the `/discover.md` route (text/markdown response) and the
 * `ant docs generate --from-cli` CLI verb (writes to disk). manifestData
 * stays the single source of truth.
 *
 * Layout: one section per status group (available / needs-wrapper /
 * planned). Each verb gets an H3 with usage, summary, canonical example,
 * a flag table (when flags > 0), and a source_ref line that is a real
 * Markdown link for verbs whose repo has a confirmed public remote, plain
 * inline code otherwise.
 */

import type { CliManifestVerb } from './manifest';

const REPO_BASE: Partial<Record<NonNullable<CliManifestVerb['repo']>, string>> = {
  v3: 'https://github.com/Jktfe/a-nice-terminal/blob/main/'
};

export function sourceRefMarkdownLink(verb: CliManifestVerb): string {
  const base = REPO_BASE[verb.repo ?? 'fresh-ant'];
  if (!base) return `\`${verb.source_ref}\``;
  const [fileSlug, rangeSlug] = verb.source_ref.split(':');
  if (!rangeSlug) return `[\`${verb.source_ref}\`](${base}${fileSlug})`;
  const firstRange = rangeSlug.split(',')[0];
  const [start, end] = firstRange.split('-');
  const anchor = end ? `#L${start}-L${end}` : `#L${start}`;
  return `[\`${verb.source_ref}\`](${base}${fileSlug}${anchor})`;
}

function escapeMdCell(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function renderFlagTable(verb: CliManifestVerb): string {
  if (verb.flags.length === 0) return '';
  const header = '| Flag | Type | Default | Constraint | Summary |\n| --- | --- | --- | --- | --- |';
  const rows = verb.flags
    .map((flag) =>
      `| \`--${escapeMdCell(flag.name)}\` | ${escapeMdCell(flag.type)} | ${escapeMdCell(flag.default ?? '')} | ${escapeMdCell(flag.constraint ?? '')} | ${escapeMdCell(flag.summary)} |`
    )
    .join('\n');
  return `${header}\n${rows}\n`;
}

function renderVerb(verb: CliManifestVerb): string {
  const lines: string[] = [];
  lines.push(`### \`${verb.usage}\` <a id="verb-${verb.id}"></a>`);
  lines.push('');
  lines.push(verb.summary);
  lines.push('');
  lines.push(`**Example:** \`${verb.canonical_example}\``);
  lines.push('');
  if (verb.flags.length > 0) {
    lines.push(renderFlagTable(verb));
  }
  lines.push(`**Source:** ${sourceRefMarkdownLink(verb)}`);
  if (verb.repo) {
    lines.push(`**Repo:** \`${verb.repo}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function renderSection(title: string, blurb: string, verbs: CliManifestVerb[]): string {
  if (verbs.length === 0) return '';
  const head = `## ${title} (${verbs.length})\n\n${blurb}\n\n`;
  const body = verbs.map(renderVerb).join('\n');
  return head + body;
}

export function renderManifestAsMarkdown(manifest: CliManifestVerb[], generatedAt: string = new Date().toISOString()): string {
  const available = manifest.filter((v) => v.status === 'available');
  const needsWrapper = manifest.filter((v) => v.status === 'needs-wrapper');
  const planned = manifest.filter((v) => v.status === 'planned');

  const header = [
    '# ant CLI verbs',
    '',
    `Generated from \`src/lib/cli-manifest/manifest.ts\` at ${generatedAt}.`,
    '',
    'This document is the markdown export of the canonical CLI manifest.',
    'The live HTML render is at [`/discover`](/discover).',
    '',
    `**Total verbs:** ${manifest.length}  `,
    `**Available:** ${available.length}  `,
    `**Needs wrapper:** ${needsWrapper.length}  `,
    `**Planned:** ${planned.length}`,
    '',
    '---',
    ''
  ].join('\n');

  const sections = [
    renderSection('Available now', 'Verbs you can run today. `source_ref` points at the implementation.', available),
    renderSection('Needs wrapper', "Server capability exists; CLI shape is sketched in DELIVERY-PLAN.md but the wrapper module isn't shipped yet.", needsWrapper),
    renderSection('Planned', 'Named in DELIVERY-PLAN.md or the fresh-ANT manual. Design open until a slice claim-firsts the contract.', planned)
  ]
    .filter((s) => s.length > 0)
    .join('\n---\n\n');

  return header + sections;
}
