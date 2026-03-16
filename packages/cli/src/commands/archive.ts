import type { Client } from "../client.js";
import type { Format } from "../output.js";
import { resolveSession } from "../resolve.js";
import * as out from "../output.js";

export async function archive(client: Client, sessionName: string, opts: { format: Format }): Promise<void> {
  const session = await resolveSession(client, sessionName);
  const result = await client.patch(`/api/sessions/${session.id}`, { archived: true });
  if (opts.format === "json") { out.json(result); return; }
  process.stdout.write(`Archived "${session.name}" → "${result.name}".\n`);
}
