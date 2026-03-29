import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

export async function rooms(client: Client, opts: { format: Format }): Promise<void> {
  const data = await client.get("/api/chat-rooms");
  if (opts.format === "json") { out.json(data); return; }
  if (data.length === 0) { process.stdout.write("  No chat rooms found.\n"); return; }
  out.table([
    ["NAME", "PARTICIPANTS", "TASKS", "FILES"],
    ...data.map((r: any) => [
      r.name,
      String(r.participantCount ?? r.participants?.length ?? 0),
      String(r.tasks?.length ?? 0),
      String(r.files?.length ?? 0),
    ]),
  ]);
}
