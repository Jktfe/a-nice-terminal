import type { Client } from "../client.js";
import type { Format } from "../output.js";
import { resolveSession } from "../resolve.js";
import * as out from "../output.js";

export async function del(client: Client, sessionName: string, opts: {
  format: Format;
  force?: boolean;
}): Promise<void> {
  const session = await resolveSession(client, sessionName);
  if (!opts.force && opts.format !== "json") {
    process.stdout.write(`Delete "${session.name}" (${session.id})? This cannot be undone. [y/N] `);
    const answer = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => resolve(data.toString().trim()));
    });
    if (answer.toLowerCase() !== "y") { process.stdout.write("Cancelled.\n"); return; }
  }
  const result = await client.del(`/api/sessions/${session.id}`);
  if (opts.format === "json") { out.json(result); return; }
  process.stdout.write(`Deleted "${session.name}".\n`);
}
