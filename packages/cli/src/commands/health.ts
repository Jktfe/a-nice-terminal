import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

export async function health(client: Client, opts: { format: Format }): Promise<void> {
  const result = await client.get("/api/health");
  if (opts.format === "json") { out.json(result); return; }
  process.stdout.write(`Server: ${client.config.server}\nStatus: ${result.status || "ok"}\n`);
}
