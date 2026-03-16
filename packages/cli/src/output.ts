import chalk from "chalk";

export type Format = "human" | "json";

export function json(data: any): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function error(msg: string): void {
  process.stderr.write(chalk.red(`Error: ${msg}\n`));
}

export function header(text: string): void {
  process.stdout.write(chalk.dim(`── ${text} ${"─".repeat(Math.max(0, 50 - text.length))}`) + "\n");
}

export function sessionLine(s: { name: string; type: string; id: string; updated_at?: string; archived?: number }): string {
  const typeTag = s.type === "terminal" ? chalk.green("terminal") : chalk.blue("conversation");
  const archived = s.archived ? chalk.yellow(" (archived)") : "";
  return `  ${chalk.white(s.name.padEnd(24))} ${typeTag}${archived}  ${chalk.dim(s.id)}`;
}

export function messageLine(m: { role: string; sender_name?: string; content: string; created_at?: string }): void {
  const sender = m.sender_name || m.role;
  const roleColor = m.role === "human" ? chalk.cyan : m.role === "agent" ? chalk.green : chalk.yellow;
  process.stdout.write(`\n  ${roleColor(sender)} ${chalk.dim("·")} ${chalk.dim(m.created_at || "")}\n`);
  process.stdout.write(`  ${m.content}\n`);
}

export function table(rows: string[][]): void {
  if (rows.length === 0) return;
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] || "").length)));
  for (const row of rows) {
    process.stdout.write("  " + row.map((cell, i) => cell.padEnd(widths[i] + 2)).join("") + "\n");
  }
}
