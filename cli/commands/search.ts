import { api } from '../lib/api.js';

export async function search(args: string[], flags: any, ctx: any) {
  const query = args.join(' ');
  if (!query) {
    console.error('Usage: ant search <query>');
    return;
  }

  const limit = flags.limit || 20;
  const data = await api.get(ctx, `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  const results = data.results || [];

  if (ctx.json) { console.log(JSON.stringify(results)); return; }

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  console.log(`Found ${results.length} results:\n`);
  for (const r of results) {
    console.log(`  \x1b[1m${r.session_id}\x1b[0m (${r.role}) — ${r.created_at}`);
    // Show snippet with highlighting (marks become bold in terminal)
    const snippet = (r.snippet || r.content.slice(0, 100))
      .replace(/<mark>/g, '\x1b[33m')
      .replace(/<\/mark>/g, '\x1b[0m');
    console.log(`  ${snippet}\n`);
  }
}
