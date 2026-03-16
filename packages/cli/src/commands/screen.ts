import type { Client } from "../client.js";
import type { Format } from "../output.js";
import { resolveSession } from "../resolve.js";
import * as out from "../output.js";

export async function screen(client: Client, sessionName: string, opts: {
  format: Format;
  plain?: boolean;
  lines?: number;
}): Promise<void> {
  const session = await resolveSession(client, sessionName);
  if (session.type !== "terminal") {
    throw new Error("screen requires a terminal session");
  }
  const format = opts.plain ? "plain" : "ansi";
  const result = await client.get(`/api/sessions/${session.id}/terminal/state?format=${format}`);
  if (opts.format === "json") { out.json(result); return; }
  let state = result.state || "";
  if (opts.lines) {
    const lines = state.split("\n");
    state = lines.slice(-opts.lines).join("\n");
  }
  process.stdout.write(state + "\n");
}
