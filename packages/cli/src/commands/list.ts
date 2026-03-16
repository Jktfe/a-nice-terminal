import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

export async function list(client: Client, opts: {
  format: Format;
  archived?: boolean;
  type?: string;
  workspace?: string;
}): Promise<void> {
  const sessions = await client.get("/api/sessions?include_archived=true");
  let filtered = sessions;
  if (opts.archived) {
    filtered = filtered.filter((s: any) => s.archived);
  } else {
    filtered = filtered.filter((s: any) => !s.archived);
  }
  if (opts.type) {
    filtered = filtered.filter((s: any) => s.type === opts.type);
  }
  if (opts.workspace) {
    const workspaces = await client.get("/api/workspaces");
    const ws = workspaces.find((w: any) => w.name.toLowerCase() === opts.workspace!.toLowerCase());
    if (ws) filtered = filtered.filter((s: any) => s.workspace_id === ws.id);
    else filtered = [];
  }
  if (opts.format === "json") { out.json(filtered); return; }
  if (filtered.length === 0) { process.stdout.write("  No sessions found.\n"); return; }
  out.table([
    ["NAME", "TYPE", "ID", "STATUS"],
    ...filtered.map((s: any) => [s.name, s.type, s.id, s.archived ? "archived" : "active"]),
  ]);
}
