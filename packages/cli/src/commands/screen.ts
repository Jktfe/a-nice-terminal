import type { Client } from "../client.js";
import type { Format } from "../output.js";
import { resolveSession } from "../resolve.js";
import * as out from "../output.js";

// NOTE (Phase 3): Full ANSI state machine reconstruction is deferred.
// For now, `screen` fetches the live headless terminal mirror via
// GET /api/sessions/:id/terminal/state. If that endpoint returns 503
// (no headless mirror active), we fall back to the last N lines of
// captured output from GET /api/sessions/:id/terminal/output — which is
// a simple tail, not a true screen reconstruction. Phase 3 will replay
// the captured ANSI byte stream through an in-process terminal emulator
// to produce an accurate screen grid.
const SCREEN_FALLBACK_LINES = 200;

export async function screen(client: Client, sessionName: string, opts: {
  format: Format;
  plain?: boolean;
  lines?: number;
}): Promise<void> {
  const session = await resolveSession(client, sessionName);
  if (session.type !== "terminal") {
    throw new Error("screen requires a terminal session");
  }

  const format = opts.plain ? "plain" : "ansi";
  let result: any;
  let usedFallback = false;

  try {
    result = await client.get(`/api/sessions/${session.id}/terminal/state?format=${format}`);
  } catch (err: any) {
    // 503 = no headless mirror active; fall back to captured output tail
    if (err?.status !== 503) throw err;
    usedFallback = true;
    const fallbackLimit = opts.lines ?? SCREEN_FALLBACK_LINES;
    const raw = await client.get(`/api/sessions/${session.id}/terminal/output?limit=${fallbackLimit}`);
    const events: Array<{ data: string }> = raw.events || [];
    const combined = events.map((e) => e.data).join("");
    const text = opts.plain ? combined.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") : combined;
    const tailLines = text.split("\n");
    const sliced = opts.lines ? tailLines.slice(-opts.lines).join("\n") : tailLines.join("\n");
    result = { state: sliced, fallback: true };
  }

  if (opts.format === "json") {
    out.json({ ...result, usedFallback });
    return;
  }

  let state = result.state || "";
  if (!usedFallback && opts.lines) {
    const lines = state.split("\n");
    state = lines.slice(-opts.lines).join("\n");
  }
  process.stdout.write(state + "\n");
}
