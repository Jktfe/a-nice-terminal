import type { Client } from "../client.js";
import type { Format } from "../output.js";
import { resolveSession } from "../resolve.js";
import * as out from "../output.js";

export async function filter(client: Client, sessionName: string, sender: string, opts: {
  format: Format;
  limit?: number;
  role?: string;
}): Promise<void> {
  const session = await resolveSession(client, sessionName);
  const messages = await client.get(`/api/sessions/${session.id}/messages?limit=${opts.limit || 100}`);
  const senderLower = sender.toLowerCase();
  let filtered = messages.filter((m: any) =>
    (m.sender_name || "").toLowerCase() === senderLower ||
    (m.sender_type || "").toLowerCase() === senderLower ||
    m.role.toLowerCase() === senderLower
  );
  if (opts.role) filtered = filtered.filter((m: any) => m.role === opts.role);
  if (opts.format === "json") { out.json(filtered); return; }
  out.header(`${session.name} — filtered by "${sender}"`);
  for (const m of filtered) out.messageLine(m);
  out.header(`${filtered.length} messages`);
}
