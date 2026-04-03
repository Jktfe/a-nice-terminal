import type { Client } from "../client.js";
import type { Format } from "../output.js";
import * as out from "../output.js";

// ---------------------------------------------------------------------------
// ant workflow list
// ---------------------------------------------------------------------------

export async function workflowList(client: Client, opts: { format: Format }): Promise<void> {
  const rows = await client.get("/api/v2/workflows") as any[];

  if (opts.format === "json") { out.json(rows); return; }
  if (!rows || rows.length === 0) {
    process.stdout.write("  No workflows found.\n");
    return;
  }
  out.table([
    ["ID", "RECIPE", "STATUS", "STEPS", "STARTED"],
    ...rows.map((r: any) => [
      r.id,
      r.recipe_name ?? "",
      r.status ?? "running",
      String(r.step_count ?? 0),
      (r.started_at ?? "").slice(0, 16),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// ant workflow status <id>
// ---------------------------------------------------------------------------

export async function workflowStatus(client: Client, id: string, opts: { format: Format }): Promise<void> {
  const data = await client.get(`/api/v2/workflows/${encodeURIComponent(id)}`) as any;

  if (opts.format === "json") { out.json(data); return; }

  process.stdout.write(`Workflow: ${data.id}\n`);
  process.stdout.write(`Recipe:   ${data.recipe_name}\n`);
  process.stdout.write(`Status:   ${data.status}\n`);
  if (data.started_at) process.stdout.write(`Started:  ${data.started_at}\n`);
  if (data.finished_at) process.stdout.write(`Finished: ${data.finished_at}\n`);

  if (data.steps && data.steps.length > 0) {
    process.stdout.write("\nSteps:\n");
    out.table([
      ["#", "TITLE", "SESSION", "LAST CMD", "EXIT"],
      ...data.steps.map((s: any) => [
        String(s.step_index + 1),
        s.step_title ?? "",
        s.session_id,
        (s.last_command ?? "").slice(0, 40),
        s.last_exit_code !== null ? String(s.last_exit_code) : "—",
      ]),
    ]);
  }
}

// ---------------------------------------------------------------------------
// ant workflow launch <recipe-id> [--param key=value ...]
// ---------------------------------------------------------------------------

export async function workflowLaunch(
  client: Client,
  recipeId: string,
  opts: { format: Format; param?: string[] }
): Promise<void> {
  // Parse --param key=value flags into a Record
  const params: Record<string, string> = {};
  for (const p of opts.param ?? []) {
    const eq = p.indexOf("=");
    if (eq === -1) {
      out.error(`Invalid --param format: "${p}" (expected key=value)`);
      process.exit(1);
    }
    params[p.slice(0, eq)] = p.slice(eq + 1);
  }

  const result = await client.post("/api/v2/workflows/launch", { recipe_id: recipeId, params }) as any;

  if (opts.format === "json") { out.json(result); return; }

  process.stdout.write(`Workflow: ${result.workflow_id}\n`);
  process.stdout.write(`Recipe:   ${result.recipe_name}\n`);
  process.stdout.write(`Ghostty:  ${result.ghostty_available ? "yes" : "no (sessions created without tabs)"}\n`);
  process.stdout.write("\nSteps:\n");
  out.table([
    ["#", "TITLE", "SESSION"],
    ...result.steps.map((s: any) => [String(s.step_index + 1), s.title, s.session_id]),
  ]);
}

// ---------------------------------------------------------------------------
// ant workflow cancel <id>
// ---------------------------------------------------------------------------

export async function workflowCancel(client: Client, id: string, opts: { format: Format }): Promise<void> {
  const result = await client.patch(`/api/v2/workflows/${encodeURIComponent(id)}`, { status: "cancelled" }) as any;

  if (opts.format === "json") { out.json(result); return; }
  process.stdout.write(`Workflow ${result.id} cancelled.\n`);
}
