// ANT v3 CLI — research docs (`ant doc`)
//
//   ant doc create <id> --title <title> [--description <desc>] [--author @x]
//   ant doc get <id>
//   ant doc list
//   ant doc section <id> <sectionId> --heading <h> --content <c> [--author @x] [--signed-off]
//   ant doc signoff <id> --author @x
//   ant doc publish <id> --author @x
//
// Research docs live in two surfaces by design:
//   - Server-side: memories K/V at docs/<id> (root) and docs/<id>/sections/<sectionId>.
//   - Vault-side: $ANT_OBSIDIAN_VAULT/research/<id>.md (mirror written on every API write).
//
// `ant doc` goes through the doc API, which keeps both surfaces in sync and
// runs the section/sign-off/publish lifecycle. Direct `ant memory put docs/<id>`
// bypasses the Obsidian mirror and the lifecycle — use `ant doc` instead.
//
// See docs/ant-agent-feature-protocols.md Section 12 for the full protocol.

import { api } from '../lib/api.js';

interface Ctx {
  serverUrl: string;
  apiKey: string;
  json: boolean;
}

export async function doc(args: string[], flags: any, ctx: Ctx) {
  const sub = args[0];

  if (!sub) {
    printUsage();
    return;
  }

  if (sub === 'create')   return create(args.slice(1), flags, ctx);
  if (sub === 'get')      return get(args.slice(1), flags, ctx);
  if (sub === 'list')     return list(flags, ctx);
  if (sub === 'section')  return section(args.slice(1), flags, ctx);
  if (sub === 'signoff')  return action(args.slice(1), flags, ctx, 'sign-off');
  if (sub === 'publish')  return action(args.slice(1), flags, ctx, 'publish');

  console.error(`Unknown doc subcommand: ${sub}`);
  printUsage();
}

function printUsage() {
  console.error('Usage: ant doc <create|get|list|section|signoff|publish> [args]');
  console.error('');
  console.error('  ant doc create <id> --title "..." [--description "..."] [--author @x]');
  console.error('  ant doc get <id>');
  console.error('  ant doc list');
  console.error('  ant doc section <id> <sectionId> --heading "..." --content "..." [--author @x] [--signed-off]');
  console.error('  ant doc signoff <id> --author @x');
  console.error('  ant doc publish <id> --author @x');
  console.error('');
  console.error('Research docs are stored in memories K/V (docs/<id>) and mirrored to');
  console.error('$ANT_OBSIDIAN_VAULT/research/<id>.md. See docs/ant-agent-feature-protocols.md');
  console.error('Section 12 for the protocol.');
}

async function create(args: string[], flags: any, ctx: Ctx) {
  const id = args[0];
  if (!id) {
    console.error('Usage: ant doc create <id> --title "..." [--description "..."] [--author @x]');
    return;
  }
  const title = typeof flags.title === 'string' ? flags.title : undefined;
  if (!title) {
    console.error('--title is required');
    return;
  }
  const description = typeof flags.description === 'string' ? flags.description : undefined;
  const author = typeof flags.author === 'string' ? flags.author : undefined;

  const result = await api.post(ctx, '/api/docs', { id, title, description, author });
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`✓ created doc \x1b[1m${id}\x1b[0m  "${title}"`);
  console.log(`  status: ${result.status || 'draft'}`);
  console.log(`  vault:  $ANT_OBSIDIAN_VAULT/research/${id}.md`);
}

async function get(args: string[], flags: any, ctx: Ctx) {
  const id = args[0];
  if (!id) { console.error('Usage: ant doc get <id>'); return; }
  const result = await api.get(ctx, `/api/docs/${encodeURIComponent(id)}`);
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`\x1b[1m${result.title || id}\x1b[0m  \x1b[90m(${id})\x1b[0m`);
  console.log(`status: ${result.status}  authors: ${(result.authors || []).join(', ') || '(none)'}`);
  console.log('');
  console.log(result.markdown);
}

async function list(flags: any, ctx: Ctx) {
  const result = await api.get(ctx, '/api/docs');
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  const docs = result.docs || [];
  if (docs.length === 0) { console.log('(no research docs yet)'); return; }
  console.log(`${docs.length} research doc${docs.length === 1 ? '' : 's'}:\n`);
  for (const d of docs) {
    const status = (d.status || 'draft').padEnd(10);
    const authors = (d.authors || []).join(',') || '—';
    console.log(`  \x1b[1m${d.id}\x1b[0m  \x1b[90m${status}\x1b[0m  ${d.title}`);
    if (d.description) console.log(`    ${d.description}`);
    console.log(`    \x1b[90mauthors: ${authors}  updated: ${d.updated_at}\x1b[0m`);
  }
}

async function section(args: string[], flags: any, ctx: Ctx) {
  const id = args[0];
  const sectionId = args[1];
  if (!id || !sectionId) {
    console.error('Usage: ant doc section <id> <sectionId> --heading "..." --content "..." [--author @x] [--signed-off]');
    return;
  }
  const heading = typeof flags.heading === 'string' ? flags.heading : sectionId;
  const content = typeof flags.content === 'string' ? flags.content : '';
  if (!content) {
    console.error('--content is required');
    return;
  }
  const author = typeof flags.author === 'string' ? flags.author : undefined;
  const signedOff = Boolean(flags['signed-off'] || flags.signedOff);

  const result = await api.put(ctx, `/api/docs/${encodeURIComponent(id)}`, {
    sectionId,
    heading,
    content,
    author,
    signedOff,
  });
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`✓ section \x1b[1m${sectionId}\x1b[0m  ${signedOff ? '✓ signed off' : '(draft)'}`);
}

async function action(args: string[], flags: any, ctx: Ctx, kind: 'sign-off' | 'publish') {
  const id = args[0];
  if (!id) { console.error(`Usage: ant doc ${kind === 'sign-off' ? 'signoff' : 'publish'} <id> --author @x`); return; }
  const author = typeof flags.author === 'string' ? flags.author : undefined;
  if (!author) {
    console.error('--author is required');
    return;
  }
  const result = await api.post(ctx, `/api/docs/${encodeURIComponent(id)}`, { author, action: kind });
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  if (kind === 'sign-off') {
    console.log(`✓ ${author} signed off  status: ${result.status}`);
    if (Array.isArray(result.signOffs)) {
      console.log(`  signOffs: ${result.signOffs.join(', ')}`);
    }
  } else {
    console.log(`✓ published  status: ${result.status}`);
  }
}
