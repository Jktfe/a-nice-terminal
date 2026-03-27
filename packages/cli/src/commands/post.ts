import type { Client } from "../client.js";
import type { Format } from "../output.js";
import { resolveSession } from "../resolve.js";
import { parseKey, parseSequence } from "../keys.js";
import * as out from "../output.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function post(client: Client, sessionName: string, message: string | undefined, opts: {
  format: Format;
  role?: string;
  senderName?: string;
  senderType?: string;
  key?: string;
  seq?: string;
  raw?: boolean;
}): Promise<void> {
  const session = await resolveSession(client, sessionName);

  if (session.type === "terminal") {
    if (opts.key) {
      const data = parseKey(opts.key);
      const result = await client.post(`/api/sessions/${session.id}/terminal/input`, { data });
      if (opts.format === "json") { out.json(result); return; }
      process.stdout.write("Key sent.\n");
      return;
    }
    if (opts.seq) {
      const steps = parseSequence(opts.seq);
      for (const step of steps) {
        if (step.type === "wait") { await sleep(step.ms); }
        else { await client.post(`/api/sessions/${session.id}/terminal/input`, { data: step.data }); }
      }
      if (opts.format === "json") { out.json({ accepted: true, steps: steps.length }); return; }
      process.stdout.write(`Sequence sent (${steps.length} steps).\n`);
      return;
    }
    let data = message;
    if (!data && !process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      data = Buffer.concat(chunks).toString("utf-8");
    }
    if (!data) throw new Error("No message provided. Pass text as argument or pipe via stdin.");
    if (!opts.raw) data += "\r";
    const result = await client.post(`/api/sessions/${session.id}/terminal/input`, { data });
    if (opts.format === "json") { out.json(result); return; }
    process.stdout.write("Sent to terminal.\n");
    return;
  }

  // Conversation
  if (opts.key || opts.seq) throw new Error("--key and --seq are only valid for terminal sessions");
  let content = message;
  if (!content && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    content = Buffer.concat(chunks).toString("utf-8");
  }
  if (!content) throw new Error("No message provided. Pass text as argument or pipe via stdin.");
  const body: any = { content, role: opts.role || "agent" };
  if (opts.senderName) body.sender_name = opts.senderName;
  if (opts.senderType) body.sender_type = opts.senderType;
  const result = await client.post(`/api/sessions/${session.id}/messages`, body);
  if (opts.format === "json") { out.json(result); return; }
  process.stdout.write(`Message posted (${result.id}).\n`);
}
