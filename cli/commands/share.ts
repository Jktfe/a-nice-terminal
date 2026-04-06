import { api } from '../lib/api.js';

export async function share(args: string[], flags: any, ctx: any) {
  const id = args[0];
  if (!id) {
    console.error('Usage: ant share <session-id>');
    process.exit(1);
  }

  const result = await api.post(ctx, `/api/sessions/${id}/share`, {});
  const url = result.url || result.shareUrl || result.link;

  if (!url) {
    console.error('Server did not return a share URL:', JSON.stringify(result));
    process.exit(1);
  }

  if (ctx.json) {
    console.log(JSON.stringify({ url }));
    return;
  }

  console.log(`\nShare URL: ${url}\n`);
}
