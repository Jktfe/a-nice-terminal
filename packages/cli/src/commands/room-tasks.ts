import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

export async function roomTasks(client: Client, name: string, opts: {
  format: Format;
  status?: string;
}): Promise<void> {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  const qs = params.toString();
  const tasks = await client.get(`/api/chat-rooms/${encodeURIComponent(name)}/tasks${qs ? `?${qs}` : ""}`);
  if (opts.format === "json") { out.json(tasks); return; }
  if (tasks.length === 0) { process.stdout.write("  No tasks found.\n"); return; }
  out.header(`${name} — tasks`);
  out.table([
    ["NAME", "STATUS", "ASSIGNED"],
    ...tasks.map((t: any) => [t.name || "", t.status || "", t.assignedTo || ""]),
  ]);
}
