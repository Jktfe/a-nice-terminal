/**
 * Export API — Obsidian markdown and Asciicast v3.
 *
 * GET /api/v2/export/obsidian/:sessionId  → markdown file download
 * GET /api/sessions/:sessionId/export/asciicast → .cast file download
 */

import { Router } from "express";
import db from "../db.js";
import { stripAnsi } from "../types.js";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeYaml(value: string): string {
  // Simple YAML scalar escape: wrap in single quotes, escape embedded quotes
  return `'${value.replace(/'/g, "''")}'`;
}

function formatDurationMs(ms: number | null): string {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ─── Obsidian export ──────────────────────────────────────────────────────────

router.get("/api/v2/export/obsidian/:sessionId", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.sessionId) as any;
  if (!session) return res.status(404).json({ error: "Session not found" });

  const commands = db
    .prepare(`
      SELECT command, exit_code, output, started_at, completed_at, duration_ms, cwd
      FROM command_events
      WHERE session_id = ?
      ORDER BY started_at ASC
    `)
    .all(req.params.sessionId) as any[];

  const facts = db
    .prepare(`
      SELECT category, key, value, confidence, created_at
      FROM knowledge_facts
      WHERE source_session_id = ?
      ORDER BY category, key
    `)
    .all(req.params.sessionId) as any[];

  const messages = db
    .prepare(`
      SELECT role, content, sender_name, created_at
      FROM messages
      WHERE session_id = ? AND message_type != 'command_result'
      ORDER BY created_at ASC
      LIMIT 200
    `)
    .all(req.params.sessionId) as any[];

  // ── Compute stats ──
  const totalCommands = commands.length;
  const failedCommands = commands.filter((c) => c.exit_code !== null && c.exit_code !== 0).length;
  const totalDurationMs = commands.reduce((sum, c) => sum + (c.duration_ms ?? 0), 0);
  const uniqueCwds = [...new Set(commands.map((c) => c.cwd).filter(Boolean))];
  const tags = ["ant-session", session.type];
  if (failedCommands > 0) tags.push("has-errors");
  if (facts.length > 0) tags.push("has-knowledge");

  // ── YAML frontmatter ──
  const frontmatter = [
    "---",
    `title: ${escapeYaml(session.name)}`,
    `session_id: ${session.id}`,
    `session_type: ${session.type}`,
    `created: ${session.created_at.slice(0, 10)}`,
    `exported: ${new Date().toISOString().slice(0, 10)}`,
    `commands: ${totalCommands}`,
    `failed_commands: ${failedCommands}`,
    `total_duration: ${escapeYaml(formatDurationMs(totalDurationMs))}`,
    `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`,
    "---",
    "",
  ].join("\n");

  // ── Body ──
  const lines: string[] = [];

  lines.push(`# ${session.name}`, "");

  // Summary table
  lines.push("## Summary", "");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Session | \`${session.id}\` |`);
  lines.push(`| Type | ${session.type} |`);
  lines.push(`| Created | ${session.created_at} |`);
  lines.push(`| Commands run | ${totalCommands} |`);
  lines.push(`| Failed | ${failedCommands} |`);
  lines.push(`| Total duration | ${formatDurationMs(totalDurationMs)} |`);
  if (uniqueCwds.length > 0) {
    lines.push(`| Directories | ${uniqueCwds.map((d) => `\`${d}\``).join(", ")} |`);
  }
  lines.push("");

  // Knowledge facts
  if (facts.length > 0) {
    lines.push("## Knowledge", "");
    const byCategory = facts.reduce((acc: Record<string, typeof facts>, f) => {
      (acc[f.category] ??= []).push(f);
      return acc;
    }, {});
    for (const [category, items] of Object.entries(byCategory)) {
      lines.push(`### ${category}`, "");
      for (const item of items) {
        const conf = item.confidence < 1 ? ` _(${Math.round(item.confidence * 100)}% confidence)_` : "";
        lines.push(`- **${item.key}**: ${item.value}${conf}`);
      }
      lines.push("");
    }
  }

  // Command history
  if (commands.length > 0) {
    lines.push("## Command History", "");
    for (const cmd of commands) {
      const status = cmd.exit_code === null ? "⏳" : cmd.exit_code === 0 ? "✅" : `❌ (exit ${cmd.exit_code})`;
      const duration = formatDurationMs(cmd.duration_ms);
      const cwd = cmd.cwd ? ` \`${cmd.cwd}\`` : "";
      lines.push(`### \`${cmd.command}\``, "");
      lines.push(`${status}${duration ? " · " + duration : ""}${cwd}`, "");
      if (cmd.output) {
        const plain = stripAnsi(cmd.output).trim();
        if (plain) {
          lines.push("```");
          lines.push(plain.length > 2000 ? plain.slice(0, 2000) + "\n… (truncated)" : plain);
          lines.push("```", "");
        }
      }
    }
  }

  // Chat messages
  if (messages.length > 0) {
    lines.push("## Conversation", "");
    for (const msg of messages) {
      const sender = msg.sender_name ?? msg.role;
      const ts = msg.created_at.slice(11, 16);
      lines.push(`**[${ts}] ${sender}**: ${msg.content.slice(0, 500)}`, "");
    }
  }

  // Wikilinks to related sessions (shared cwd or room)
  const related = db
    .prepare(`
      SELECT DISTINCT s.name
      FROM sessions s
      JOIN command_events ce ON ce.session_id = s.id
      WHERE ce.cwd IN (SELECT DISTINCT cwd FROM command_events WHERE session_id = ?)
        AND s.id != ?
        AND s.archived = 0
      LIMIT 10
    `)
    .all(req.params.sessionId, req.params.sessionId) as any[];

  if (related.length > 0) {
    lines.push("## Related Sessions", "");
    lines.push(related.map((r: any) => `[[${r.name}]]`).join(" · "), "");
  }

  const markdown = frontmatter + lines.join("\n");
  const filename = `${session.name.replace(/[^a-z0-9-_ ]/gi, "_")}.md`;

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(markdown);
});

// ─── Asciicast v3 export ──────────────────────────────────────────────────────
// Specification: https://docs.asciinema.org/manual/asciicast/v3/
//
// File format: newline-delimited JSON (NDJSON)
//   Line 1: header object
//   Lines 2+: event objects [timestamp, type, data]

router.get("/api/sessions/:sessionId/export/asciicast", (req, res) => {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(req.params.sessionId) as any;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "terminal") {
    return res.status(409).json({ error: "Only terminal sessions can be exported as asciicast" });
  }

  const events = db
    .prepare(`
      SELECT data, created_at
      FROM terminal_output_events
      WHERE session_id = ?
      ORDER BY chunk_index ASC
    `)
    .all(req.params.sessionId) as Array<{ data: string; created_at: string }>;

  if (events.length === 0) {
    return res.status(404).json({ error: "No terminal output recorded for this session" });
  }

  const startMs = new Date(events[0].created_at).getTime();

  // Asciicast v3 header
  const header = {
    version: 3,
    width: 220,
    height: 50,
    timestamp: Math.floor(startMs / 1000),
    title: session.name,
    env: { TERM: "xterm-256color", SHELL: session.shell ?? "/bin/zsh" },
  };

  const ndjsonLines: string[] = [JSON.stringify(header)];

  for (const ev of events) {
    const tsSeconds = (new Date(ev.created_at).getTime() - startMs) / 1000;
    // Type "o" = output (data written to the terminal)
    ndjsonLines.push(JSON.stringify([+tsSeconds.toFixed(6), "o", ev.data]));
  }

  const filename = `${session.name.replace(/[^a-z0-9-_ ]/gi, "_")}.cast`;
  res.setHeader("Content-Type", "application/x-asciicast");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(ndjsonLines.join("\n") + "\n");
});

export default router;
