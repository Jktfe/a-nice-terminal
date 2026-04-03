import { randomUUID } from "node:crypto";
import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

// ---------------------------------------------------------------------------
// Shared helper: 503 from any terminal endpoint means Ghostty is not installed.
// ---------------------------------------------------------------------------

function handle503(err: any): never {
  if (err?.status === 503) {
    out.error("Ghostty is not installed. Install from https://ghostty.org");
    process.exit(1);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// ant create [name]
// ---------------------------------------------------------------------------

export async function terminalCreate(client: Client, name: string | undefined, opts: {
  format: Format;
  cwd?: string;
  title?: string;
}): Promise<void> {
  const sessionId = name || randomUUID();
  const body: Record<string, string> = { sessionId, cwd: opts.cwd ?? process.cwd() };
  if (opts.title) body.title = opts.title;

  let result: any;
  try {
    result = await client.post("/api/terminals", body);
  } catch (err: any) {
    handle503(err);
  }

  if (opts.format === "json") { out.json(result); return; }
  process.stdout.write(`${result.id}\n`);
}

// ---------------------------------------------------------------------------
// ant input <session> <text>   (text may be "-" to read from stdin)
// ---------------------------------------------------------------------------

export async function terminalInput(client: Client, session: string, text: string, opts: {
  format: Format;
}): Promise<void> {
  let resolved = text;
  if (text === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    resolved = Buffer.concat(chunks).toString("utf-8");
  }

  let result: any;
  try {
    result = await client.post(`/api/terminals/${encodeURIComponent(session)}/input`, { text: resolved });
  } catch (err: any) {
    handle503(err);
  }

  if (opts.format === "json") { out.json({ ok: true }); return; }
  // Silent on success — match the spec
}

// ---------------------------------------------------------------------------
// ant exec <session> <command>
// ---------------------------------------------------------------------------

export async function terminalExec(client: Client, session: string, command: string, opts: {
  format: Format;
  timeout?: number;
}): Promise<void> {
  const timeoutMs = opts.timeout ?? 30000;

  let result: any;
  try {
    result = await client.post(`/api/terminals/${encodeURIComponent(session)}/exec`, { command, timeoutMs });
  } catch (err: any) {
    handle503(err);
  }

  if (opts.format === "json") { out.json({ exitCode: result.exitCode }); return; }
  process.stdout.write(`Exit code: ${result.exitCode}\ndone\n`);
}

// ---------------------------------------------------------------------------
// ant focus <session>
// ---------------------------------------------------------------------------

export async function terminalFocus(client: Client, session: string, opts: {
  format: Format;
}): Promise<void> {
  try {
    await client.post(`/api/terminals/${encodeURIComponent(session)}/focus`);
  } catch (err: any) {
    handle503(err);
  }

  if (opts.format === "json") { out.json({ ok: true }); return; }
  // Silent on success
}

// ---------------------------------------------------------------------------
// ant close <session>
// ---------------------------------------------------------------------------

export async function terminalClose(client: Client, session: string, opts: {
  format: Format;
}): Promise<void> {
  try {
    await client.del(`/api/terminals/${encodeURIComponent(session)}`);
  } catch (err: any) {
    handle503(err);
  }

  if (opts.format === "json") { out.json({ ok: true }); return; }
  // Silent on success
}

// ---------------------------------------------------------------------------
// ant terminals  (alias: ant term list)
// ---------------------------------------------------------------------------

export async function terminalList(client: Client, opts: {
  format: Format;
}): Promise<void> {
  let terminals: any[];
  try {
    terminals = await client.get("/api/terminals");
  } catch (err: any) {
    handle503(err);
  }

  if (opts.format === "json") { out.json(terminals!); return; }
  if (!terminals! || terminals.length === 0) {
    process.stdout.write("  No terminals found.\n");
    return;
  }
  out.table([
    ["ID", "TITLE", "CWD"],
    ...terminals.map((t: any) => [t.id, t.title ?? "", t.cwd ?? ""]),
  ]);
}
