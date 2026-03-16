import type { Client } from "../client.js";
import { resolveSession } from "../resolve.js";
import { attachTerminal } from "../ws.js";

export async function attach(client: Client, sessionName: string): Promise<void> {
  const session = await resolveSession(client, sessionName);
  if (session.type !== "terminal") {
    throw new Error("attach requires a terminal session");
  }
  const exitCode = await attachTerminal(client, session);
  process.exit(exitCode);
}
