import type { Client } from "../client.js";
import type { Format } from "../output.js";
import { resolveSession } from "../resolve.js";
import * as out from "../output.js";

export async function read(client: Client, sessionName: string, opts: {
  format: Format;
  limit?: number;
  since?: string;
  follow?: boolean;
  plain?: boolean;
}): Promise<void> {
  const session = await resolveSession(client, sessionName);
  const limit = opts.limit || 1000;

  if (session.type === "conversation") {
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts.since) params.set("since", opts.since);
    const messages = await client.get(`/api/sessions/${session.id}/messages?${params}`);
    if (opts.format === "json") { out.json(messages); return; }
    out.header(`${session.name} (conversation)`);
    for (const m of messages) { out.messageLine(m); }
    out.header(`${messages.length} messages`);
  } else {
    const params = new URLSearchParams({ limit: String(limit) });
    if (opts.since) params.set("since", opts.since);
    const result = await client.get(`/api/sessions/${session.id}/terminal/output?${params}`);
    const events = result.events || [];
    if (opts.format === "json") { out.json(events); return; }
    for (const evt of events) {
      let data = evt.data;
      if (opts.plain) data = data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
      process.stdout.write(data);
    }
  }

  if (opts.follow) {
    const { followSession } = await import("../ws.js");
    await followSession(client, session, opts.format, opts.plain);
  }
}
