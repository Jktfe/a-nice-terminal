import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

export async function search(client: Client, query: string, opts: {
  format: Format;
  workspace?: string;
  limit?: number;
  includeArchived?: boolean;
}): Promise<void> {
  const params = new URLSearchParams({ q: query });
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.includeArchived) params.set("include_archived", "true");
  if (opts.workspace) {
    const workspaces = await client.get("/api/workspaces");
    const ws = workspaces.find((w: any) => w.name.toLowerCase() === opts.workspace!.toLowerCase());
    if (ws) params.set("workspace_id", ws.id);
  }
  const result = await client.get(`/api/search?${params}`);
  if (opts.format === "json") { out.json(result); return; }
  const { sessions, messages } = result;
  if (sessions.length === 0 && messages.length === 0) { process.stdout.write("  No results.\n"); return; }
  if (sessions.length > 0) {
    out.header("Sessions");
    for (const s of sessions) process.stdout.write(out.sessionLine(s) + "\n");
  }
  if (messages.length > 0) {
    out.header("Messages");
    for (const m of messages) process.stdout.write(`  ${m.session_name} · ${m.role} · ${m.content_snippet}\n`);
  }
}
