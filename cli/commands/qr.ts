import { config } from '../lib/config.js';
// @ts-ignore
import qrcode from 'qrcode-terminal';

export async function qr(args: string[], flags: any, ctx: any) {
  const url = ctx.serverUrl || config.get('serverUrl') || 'https://mac.kingfisher-interval.ts.net:6458';
  const key = ctx.apiKey || config.get('apiKey') || '';

  if (!key) {
    console.error('No API key set. Run: ant config set --key <your-key>');
    process.exit(1);
  }

  // antios:// deep-link — iOS app scans this to auto-configure
  const connectionString = `antios://connect?url=${encodeURIComponent(url)}&key=${encodeURIComponent(key)}`;

  if (ctx.json) {
    console.log(JSON.stringify({ connectionString, url, key }));
    return;
  }

  console.log('\nScan to connect ANTios:\n');
  qrcode.generate(connectionString, { small: true });
  console.log(`\nServer: ${url}`);
  console.log(`Key:    ${key.slice(0, 8)}${'*'.repeat(key.length - 8)}\n`);
}
