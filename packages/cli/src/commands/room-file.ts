import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

export async function roomFile(client: Client, name: string, path: string, opts: {
  format: Format;
  desc?: string;
  type?: string;
  short?: string;
}): Promise<void> {
  const body: Record<string, string> = { path };
  if (opts.desc) body.description = opts.desc;
  if (opts.type) body.fileType = opts.type;
  if (opts.short) body.shortName = opts.short;
  const result = await client.post(`/api/chat-rooms/${encodeURIComponent(name)}/files`, body);
  if (opts.format === "json") { out.json(result); return; }
  process.stdout.write(`  File '${path}' added to ${name}.\n`);
}
