import { api } from '../lib/api.js';

// M2.2 full: --scope messages,plans,tasks,docs,artefacts (CSV). Default
// messages-only preserves pre-M2.2 CLI behaviour. Each result row carries a
// `kind` discriminator from the server; artefacts rows also carry `sub_kind`
// (deck/sheet/tunnel/grant) for the fan-out across artefact substores.
export async function search(args: string[], flags: any, ctx: any) {
  const query = args.join(' ');
  if (!query) {
    console.error('Usage: ant search <query> [--scope messages,plans,tasks,docs,artefacts] [--limit N] [--json]');
    return;
  }

  const limit = flags.limit || 20;
  const scope = flags.scope ? `&scope=${encodeURIComponent(flags.scope)}` : '';
  const data = await api.get(ctx, `/api/search?q=${encodeURIComponent(query)}&limit=${limit}${scope}`);
  const results = data.results || [];

  if (ctx.json) { console.log(JSON.stringify(results)); return; }

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  console.log(`Found ${results.length} results:\n`);
  for (const r of results) {
    const kind = r.kind || 'messages';
    if (kind === 'messages') {
      console.log(`  \x1b[1m[messages]\x1b[0m \x1b[1m${r.session_id}\x1b[0m (${r.role}) — ${r.created_at}`);
      const snippet = (r.snippet || (r.content || '').slice(0, 100))
        .replace(/<mark>/g, '\x1b[33m')
        .replace(/<\/mark>/g, '\x1b[0m');
      console.log(`  ${snippet}\n`);
    } else if (kind === 'plans') {
      console.log(`  \x1b[1m[plans]\x1b[0m session=${r.session_id} ts=${r.created_at}`);
      console.log(`  ${(r.text || '').slice(0, 160)}\n`);
    } else if (kind === 'tasks') {
      console.log(`  \x1b[1m[tasks]\x1b[0m ${r.id} status=${r.status} — ${r.title}`);
      if (r.description) console.log(`  ${String(r.description).slice(0, 160)}`);
      console.log('');
    } else if (kind === 'docs') {
      console.log(`  \x1b[1m[docs]\x1b[0m ${r.key} — updated ${r.updated_at}`);
      console.log(`  ${String(r.value || '').slice(0, 160)}\n`);
    } else if (kind === 'artefacts') {
      const sub = r.sub_kind || 'artefact';
      if (sub === 'grant') {
        console.log(`  \x1b[1m[artefacts/grant]\x1b[0m ${r.id} topic=${r.topic} → ${r.granted_to} (${r.status})`);
        console.log('');
      } else if (sub === 'tunnel') {
        console.log(`  \x1b[1m[artefacts/tunnel]\x1b[0m ${r.slug} — ${r.title} → ${r.public_url}`);
        console.log('');
      } else {
        console.log(`  \x1b[1m[artefacts/${sub}]\x1b[0m ${r.slug} — ${r.title} (updated ${r.updated_at})`);
        console.log('');
      }
    }
  }
}
