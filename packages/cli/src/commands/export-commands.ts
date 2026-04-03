import fs from "node:fs";
import path from "node:path";
import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

// ---------------------------------------------------------------------------
// Shared: fetch raw text/binary from a path and optionally save to file
// ---------------------------------------------------------------------------

async function fetchRaw(client: Client, urlPath: string): Promise<{ body: string; filename: string }> {
  // We need raw response headers for filename — call fetch directly using the
  // client's base URL and API key, which are exposed via client.config.
  const headers: Record<string, string> = { Accept: "*/*" };
  if (client.config.apiKey) {
    headers["X-API-Key"] = client.config.apiKey;
    headers["Authorization"] = `Bearer ${client.config.apiKey}`;
  }

  const res = await fetch(`${client.config.server}${urlPath}`, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message: string;
    try { message = JSON.parse(text).error || text; } catch { message = text || `HTTP ${res.status}`; }
    const err = new Error(message) as Error & { status: number };
    err.status = res.status;
    throw err;
  }

  const body = await res.text();
  // Extract filename from Content-Disposition header
  const cd = res.headers.get("content-disposition") ?? "";
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : urlPath.split("/").pop() ?? "export";
  return { body, filename };
}

// ---------------------------------------------------------------------------
// ant export obsidian <session> [--out <path>]
// ---------------------------------------------------------------------------

export async function exportObsidian(
  client: Client,
  session: string,
  opts: { format: Format; out?: string }
): Promise<void> {
  const { body, filename } = await fetchRaw(client, `/api/v2/export/obsidian/${encodeURIComponent(session)}`);

  const outPath = opts.out ?? filename;
  fs.writeFileSync(outPath, body, "utf-8");

  if (opts.format === "json") { out.json({ path: path.resolve(outPath), bytes: body.length }); return; }
  process.stdout.write(`Exported Obsidian note → ${path.resolve(outPath)}\n`);
}

// ---------------------------------------------------------------------------
// ant export asciicast <session> [--out <path>]
// ---------------------------------------------------------------------------

export async function exportAsciicast(
  client: Client,
  session: string,
  opts: { format: Format; out?: string }
): Promise<void> {
  const { body, filename } = await fetchRaw(client, `/api/sessions/${encodeURIComponent(session)}/export/asciicast`);

  const outPath = opts.out ?? filename;
  fs.writeFileSync(outPath, body, "utf-8");

  if (opts.format === "json") { out.json({ path: path.resolve(outPath), bytes: body.length }); return; }
  process.stdout.write(`Exported Asciicast → ${path.resolve(outPath)}\n`);
  process.stdout.write(`  Play with: asciinema play ${path.resolve(outPath)}\n`);
}
