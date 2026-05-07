// antchat doc — research-doc cowork from remote machines.
//
// Wraps the same /api/docs endpoints as `ant doc` (cli/commands/doc.ts) but
// uses the per-room bearer token from `config.listRoomTokens()` instead of
// the host's master ANT_API_KEY. Marco's agent runs this against his
// local ant server (via the share string he joined with).
//
// Usage shape: room-id is the first positional arg (matches antchat msg/chat
// pattern) so the token lookup is unambiguous.
//
//   antchat doc <room-id> create <id> --title "..." [--description "..."] [--author @x]
//   antchat doc <room-id> get <id>
//   antchat doc <room-id> list
//   antchat doc <room-id> section <id> <secId> --heading "..." --content "..."
//                                               [--author @x] [--signed-off]
//   antchat doc <room-id> signoff <id> --author @x
//   antchat doc <room-id> publish <id> --author @x
//
// Stored in memories K/V (docs/<id>) and mirrored to
// $ANT_OBSIDIAN_VAULT/research/<id>.md on the server. See
// docs/ant-agent-feature-protocols.md Section 12 for the protocol.

import { config } from '../../cli/lib/config.js';
import { api } from '../../cli/lib/api.js';

interface Ctx { serverUrl: string; apiKey: string; json: boolean; }

function resolveCallCtx(roomId: string, ctx: Ctx, flags: any): { callCtx: Ctx; roomToken: string } {
  const handleFlag = typeof flags.handle === 'string' ? flags.handle : undefined;
  const tok = config.getRoomToken(roomId, handleFlag);
  if (!tok) {
    if (handleFlag) {
      console.error(`antchat doc: no token for room ${roomId} under handle ${handleFlag}. Run: antchat join …`);
    } else {
      console.error(`antchat doc: no token for room ${roomId}. Run: antchat join …`);
    }
    process.exit(1);
  }
  const serverUrl = (ctx.serverUrl || tok.server_url || config.get('serverUrl') || '').trim();
  if (!serverUrl) {
    console.error('antchat doc: no server URL — pass --server or rejoin to capture server_url in the token.');
    process.exit(1);
  }
  return { callCtx: { ...ctx, serverUrl }, roomToken: tok.token };
}

export async function doc(args: string[], flags: any, ctx: Ctx) {
  const roomId = args[0];
  const sub = args[1];

  if (!roomId || !sub) {
    printUsage();
    return;
  }

  const { callCtx, roomToken } = resolveCallCtx(roomId, ctx, flags);
  const opts = { roomToken };

  try {
    if (sub === 'list')      return list(callCtx, opts);
    if (sub === 'create')    return create(args.slice(2), flags, callCtx, opts);
    if (sub === 'get')       return get(args.slice(2), callCtx, opts);
    if (sub === 'section')   return section(args.slice(2), flags, callCtx, opts);
    if (sub === 'signoff')   return action(args.slice(2), flags, callCtx, opts, 'sign-off');
    if (sub === 'publish')   return action(args.slice(2), flags, callCtx, opts, 'publish');

    console.error(`antchat doc: unknown subcommand "${sub}"`);
    printUsage();
    process.exit(1);
  } catch (err: any) {
    console.error(`antchat doc: ${err.message}`);
    process.exit(1);
  }
}

function printUsage() {
  console.error('Usage: antchat doc <room-id> <create|get|list|section|signoff|publish> [args]');
  console.error('');
  console.error('  antchat doc <room> create <id> --title "..." [--description "..."] [--author @x]');
  console.error('  antchat doc <room> get <id>');
  console.error('  antchat doc <room> list');
  console.error('  antchat doc <room> section <id> <sectionId> --heading "..." --content "..." [--author @x] [--signed-off]');
  console.error('  antchat doc <room> signoff <id> --author @x');
  console.error('  antchat doc <room> publish <id> --author @x');
  console.error('');
  console.error('Research docs are stored in memories K/V (docs/<id>) on the server and mirrored');
  console.error('to $ANT_OBSIDIAN_VAULT/research/<id>.md. See docs/ant-agent-feature-protocols.md');
  console.error('Section 12 for the full protocol.');
}

async function list(ctx: Ctx, opts: { roomToken: string }) {
  const result = await api.get(ctx, '/api/docs', opts);
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  const docs = result.docs || [];
  if (!docs.length) { console.log('(no research docs yet)'); return; }
  console.log(`${docs.length} research doc${docs.length === 1 ? '' : 's'}:\n`);
  for (const d of docs) {
    const status = (d.status || 'draft').padEnd(10);
    const authors = (d.authors || []).join(',') || '—';
    console.log(`  \x1b[1m${d.id}\x1b[0m  \x1b[90m${status}\x1b[0m  ${d.title}`);
    if (d.description) console.log(`    ${d.description}`);
    console.log(`    \x1b[90mauthors: ${authors}  updated: ${d.updated_at}\x1b[0m`);
  }
}

async function create(args: string[], flags: any, ctx: Ctx, opts: { roomToken: string }) {
  const id = args[0];
  if (!id) {
    console.error('Usage: antchat doc <room> create <id> --title "..." [--description "..."] [--author @x]');
    process.exit(1);
  }
  const title = typeof flags.title === 'string' ? flags.title : undefined;
  if (!title) { console.error('--title is required'); process.exit(1); }
  const description = typeof flags.description === 'string' ? flags.description : undefined;
  const author = typeof flags.author === 'string' ? flags.author : undefined;

  const result = await api.post(ctx, '/api/docs', { id, title, description, author }, opts);
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`✓ created doc \x1b[1m${id}\x1b[0m  "${title}"`);
  console.log(`  status: ${result.status || 'draft'}`);
}

async function get(args: string[], ctx: Ctx, opts: { roomToken: string }) {
  const id = args[0];
  if (!id) { console.error('Usage: antchat doc <room> get <id>'); process.exit(1); }
  const result = await api.get(ctx, `/api/docs/${encodeURIComponent(id)}`, opts);
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`\x1b[1m${result.title || id}\x1b[0m  \x1b[90m(${id})\x1b[0m`);
  console.log(`status: ${result.status}  authors: ${(result.authors || []).join(', ') || '(none)'}`);
  console.log('');
  console.log(result.markdown);
}

async function section(args: string[], flags: any, ctx: Ctx, opts: { roomToken: string }) {
  const id = args[0];
  const sectionId = args[1];
  if (!id || !sectionId) {
    console.error('Usage: antchat doc <room> section <id> <sectionId> --heading "..." --content "..." [--author @x] [--signed-off]');
    process.exit(1);
  }
  const heading = typeof flags.heading === 'string' ? flags.heading : sectionId;
  const content = typeof flags.content === 'string' ? flags.content : '';
  if (!content) { console.error('--content is required'); process.exit(1); }
  const author = typeof flags.author === 'string' ? flags.author : undefined;
  const signedOff = Boolean(flags['signed-off'] || flags.signedOff);

  const result = await api.put(ctx, `/api/docs/${encodeURIComponent(id)}`, {
    sectionId, heading, content, author, signedOff,
  }, opts);
  if (ctx.json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`✓ section \x1b[1m${sectionId}\x1b[0m  ${signedOff ? '✓ signed off' : '(draft)'}`);
}

async function action(args: string[], flags: any, ctx: Ctx, opts: { roomToken: string }, kind: 'sign-off' | 'publish') {
  const id = args[0];
  if (!id) {
    console.error(`Usage: antchat doc <room> ${kind === 'sign-off' ? 'signoff' : 'publish'} <id> --author @x`);
    process.exit(1);
  }
  const author = typeof flags.author === 'string' ? flags.author : undefined;
  if (!author) { console.error('--author is required'); process.exit(1); }

  const result = await api.post(ctx, `/api/docs/${encodeURIComponent(id)}`, { author, action: kind }, opts);
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
