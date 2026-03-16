import type { Client } from "../client.js";
import type { Format } from "../output.js";
import { resolveSession } from "../resolve.js";
import * as out from "../output.js";

export async function members(client: Client, sessionName: string, opts: { format: Format }): Promise<void> {
  const session = await resolveSession(client, sessionName);
  const messages = await client.get(`/api/sessions/${session.id}/messages?limit=1000`);
  const counts = new Map<string, { type: string; count: number }>();
  for (const m of messages) {
    const key = m.sender_name || m.role;
    const entry = counts.get(key) || { type: m.sender_type || m.role, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const result = Array.from(counts.entries()).map(([name, { type, count }]) => ({ name, type, count }));
  if (opts.format === "json") { out.json(result); return; }
  out.header(`${session.name} — participants`);
  out.table([["SENDER", "TYPE", "MESSAGES"], ...result.map((r) => [r.name, r.type, String(r.count)])]);
}
