import { api } from '../lib/api.js';

export async function share(args: string[], flags: any, ctx: any) {
  const id = args[0];
  if (!id) {
    console.error('Usage: ant share <session-id>');
    process.exit(1);
  }

  const result = await api.get(ctx, `/api/sessions/${id}/share`);
  const url = result.url || result.shareUrl || result.link;

  if (ctx.json) {
    console.log(JSON.stringify(result));
    return;
  }

  if (url) {
    console.log(`\nShare URL: ${url}\n`);
    return;
  }

  console.log(`\nShare commands for ${result.session_name || id}:\n`);
  for (const [label, command] of Object.entries(result.commands || {})) {
    console.log(`${label}: ${command}`);
  }
  console.log('');
}
