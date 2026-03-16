import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

export async function create(client: Client, name: string, opts: {
  format: Format;
  type?: string;
  workspace?: string;
  cwd?: string;
}): Promise<void> {
  const body: any = { name, type: opts.type || "conversation" };
  if (opts.workspace) {
    const workspaces = await client.get("/api/workspaces");
    const ws = workspaces.find((w: any) => w.name.toLowerCase() === opts.workspace!.toLowerCase());
    if (ws) body.workspace_id = ws.id;
  }
  if (opts.cwd) body.cwd = opts.cwd;
  const session = await client.post("/api/sessions", body);
  if (opts.format === "json") { out.json(session); return; }
  process.stdout.write(`Created ${session.type} "${session.name}" (${session.id})\n`);
}
