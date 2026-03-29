import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

export async function room(client: Client, name: string, opts: { format: Format }): Promise<void> {
  const allRooms = await client.get("/api/chat-rooms");
  const data = allRooms.find((r: any) => r.name.toLowerCase() === name.toLowerCase());
  if (!data) throw new Error(`Room '${name}' not found`);
  if (opts.format === "json") { out.json(data); return; }

  out.header(`${data.name}`);

  if (data.participants && data.participants.length > 0) {
    out.header("Participants");
    out.table([
      ["AGENT", "MODEL", "TERMINAL"],
      ...data.participants.map((p: any) => [p.agentName || "", p.model || "", p.terminalName || ""]),
    ]);
  }

  if (data.tasks && data.tasks.length > 0) {
    out.header("Tasks");
    out.table([
      ["NAME", "STATUS", "ASSIGNED"],
      ...data.tasks.map((t: any) => [t.name || "", t.status || "", t.assignedTo || ""]),
    ]);
  }

  if (data.files && data.files.length > 0) {
    out.header("Files");
    out.table([
      ["PATH", "DESCRIPTION", "ADDED BY"],
      ...data.files.map((f: any) => [f.path || "", f.description || "", f.addedBy || ""]),
    ]);
  }

  if (data.tags && data.tags.length > 0) {
    out.header("Tags");
    out.table([
      ["TAG", "PARTICIPANT"],
      ...data.tags.map((t: any) => [t.tag || "", t.terminalSessionId || ""]),
    ]);
  }
}
