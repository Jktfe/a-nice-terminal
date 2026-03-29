import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

export async function roomTag(client: Client, name: string, terminalSessionId: string, tag: string, opts: {
  format: Format;
}): Promise<void> {
  const result = await client.post(`/api/chat-rooms/${encodeURIComponent(name)}/tags`, {
    terminalSessionId,
    tag,
  });
  if (opts.format === "json") { out.json(result); return; }
  process.stdout.write(`  Tag '${tag}' added to ${terminalSessionId} in ${name}.\n`);
}
