import type { Client } from "../client.js";
import type { Format } from "../output.js";
import { resolveSession } from "../resolve.js";
import { attachTerminal } from "../ws.js";
import * as out from "../output.js";

export async function exec(client: Client, sessionName: string, command: string | undefined, opts: {
  format: Format;
  timeout?: number;
  quiet?: boolean;
  interactive?: boolean;
}): Promise<void> {
  const session = await resolveSession(client, sessionName);
  if (session.type !== "terminal") {
    throw new Error("exec requires a terminal session");
  }

  if (opts.interactive) {
    if (command) {
      await client.post(`/api/sessions/${session.id}/terminal/input`, { data: command + "\r" });
    }
    const exitCode = await attachTerminal(client, session);
    process.exit(exitCode);
  }

  if (!command) {
    throw new Error("Provide a command or use -i for interactive mode");
  }

  const timeout = (opts.timeout || 30) * 1000;
  const result = await client.post(`/api/agent/sessions/${session.id}/exec`, { command, timeout });

  if (opts.format === "json") {
    out.json(result);
    process.exit(result.exitCode || 0);
    return;
  }

  if (!opts.quiet && result.output) {
    process.stdout.write(result.output);
  }
  process.exit(result.exitCode || 0);
}
