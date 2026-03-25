/**
 * Archive Retention Engine — session lifecycle management.
 *
 * Daily sweep finds archived sessions past their retention period,
 * parses them via a local LLM for knowledge extraction, emits both
 * a holistic digest and atomic facts, then deletes the session.
 */
import type { Server } from "socket.io";
import { nanoid } from "nanoid";
import db from "./db.js";
import { destroyPty } from "./pty-manager.js";
import { features } from "./feature-flags.js";
import { stripAnsi } from "./types.js";
import type { DbSession } from "./types.js";

// ---------------------------------------------------------------------------
// Settings helpers — read/write from server_state KV table
// ---------------------------------------------------------------------------

interface RetentionSettings {
  archive_retention_days: number;
  retention_lm_url: string;
  retention_lm_model: string;
  retention_lm_unavailable_policy: "keep" | "delete";
  last_retention_run: string | null;
}

const DEFAULTS: RetentionSettings = {
  archive_retention_days: 15,
  retention_lm_url: process.env.LM_STUDIO_URL || "http://localhost:1234",
  retention_lm_model: process.env.LM_STUDIO_MODEL || "",
  retention_lm_unavailable_policy: "keep",
  last_retention_run: null,
};

const getState = db.prepare("SELECT value FROM server_state WHERE key = ?");
const upsertState = db.prepare(
  "INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)"
);

export function getRetentionSettings(): RetentionSettings {
  const get = (key: keyof RetentionSettings) => {
    const row = getState.get(key) as { value: string } | undefined;
    return row?.value ?? undefined;
  };

  return {
    archive_retention_days: parseInt(get("archive_retention_days") || "") || DEFAULTS.archive_retention_days,
    retention_lm_url: get("retention_lm_url") || DEFAULTS.retention_lm_url,
    retention_lm_model: get("retention_lm_model") || DEFAULTS.retention_lm_model,
    retention_lm_unavailable_policy:
      (get("retention_lm_unavailable_policy") as "keep" | "delete") || DEFAULTS.retention_lm_unavailable_policy,
    last_retention_run: get("last_retention_run") || null,
  };
}

export function updateRetentionSettings(updates: Partial<RetentionSettings>): RetentionSettings {
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && key in DEFAULTS) {
      upsertState.run(key, String(value));
    }
  }
  return getRetentionSettings();
}

// ---------------------------------------------------------------------------
// LLM interaction
// ---------------------------------------------------------------------------

interface ParseResult {
  summary: string;
  key_learnings: string[];
  tags: string[];
  facts: Array<{ category: string; key: string; value: string }>;
}

const SYSTEM_PROMPT = `You are a session archivist for a terminal/chat application called ANT.
Your job is to extract concise, useful knowledge from session content before it is permanently deleted.

Respond with ONLY valid JSON in this exact format:
{
  "summary": "2-3 sentence summary of what happened in this session",
  "key_learnings": ["Learning 1", "Learning 2", "Learning 3"],
  "tags": ["tag1", "tag2", "tag3"],
  "facts": [
    { "category": "command", "key": "description of fact", "value": "the fact itself" },
    { "category": "config", "key": "description", "value": "value" }
  ]
}

Rules:
- summary: Brief overview of what the session was used for
- key_learnings: 3-5 actionable takeaways (commands that worked, solutions found, patterns discovered)
- tags: 3-5 lowercase tags for categorisation
- facts: 3-5 atomic facts that would be useful in future sessions (specific commands, config values, error fixes)
- Be concise — this is a knowledge extract, not a log dump
- Focus on what would be USEFUL to recall later`;

async function detectModel(url: string): Promise<string | null> {
  try {
    const res = await globalThis.fetch(`${url}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return data.data?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function callLLM(
  url: string,
  model: string,
  userContent: string
): Promise<ParseResult> {
  const res = await globalThis.fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model?: string;
  };

  const raw = data.choices[0]?.message?.content || "";

  // Extract JSON from the response (handle markdown code blocks)
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
  const jsonStr = (jsonMatch[1] || raw).trim();

  const parsed = JSON.parse(jsonStr) as ParseResult;

  // Validate structure
  if (!parsed.summary || !Array.isArray(parsed.key_learnings) || !Array.isArray(parsed.tags)) {
    throw new Error("LLM response missing required fields");
  }

  return {
    summary: parsed.summary,
    key_learnings: parsed.key_learnings.slice(0, 5),
    tags: parsed.tags.slice(0, 5),
    facts: (parsed.facts || []).slice(0, 5),
  };
}

// ---------------------------------------------------------------------------
// Session content extraction
// ---------------------------------------------------------------------------

function getSessionContent(session: DbSession, sessionId: string): { content: string; messageCount: number; chunkCount: number } {
  if (session.type === "conversation") {
    const messages = db
      .prepare(
        "SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 20"
      )
      .all(sessionId) as Array<{ role: string; content: string; created_at: string }>;

    if (messages.length === 0) {
      return { content: "", messageCount: 0, chunkCount: 0 };
    }

    // Reverse to chronological order
    messages.reverse();
    const transcript = messages
      .map((m) => `[${m.role}] ${m.content.slice(0, 500)}`)
      .join("\n\n");

    return { content: transcript, messageCount: messages.length, chunkCount: 0 };
  }

  // Terminal session — get last ~4000 chars of output
  const chunks = db
    .prepare(
      "SELECT data FROM terminal_output_events WHERE session_id = ? ORDER BY chunk_index DESC LIMIT 200"
    )
    .all(sessionId) as Array<{ data: string }>;

  if (chunks.length === 0) {
    return { content: "", messageCount: 0, chunkCount: 0 };
  }

  // Reverse to chronological, join, strip ANSI, truncate
  chunks.reverse();
  const raw = chunks.map((c) => c.data).join("");
  const clean = stripAnsi(raw);
  const truncated = clean.length > 4000 ? clean.slice(-4000) : clean;

  return { content: truncated, messageCount: 0, chunkCount: chunks.length };
}

// ---------------------------------------------------------------------------
// Parse a session and store the digest + facts
// ---------------------------------------------------------------------------

export async function parseSessionForKnowledge(sessionId: string): Promise<{
  digestId: string;
  factsEmitted: number;
} | null> {
  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId) as DbSession | undefined;

  if (!session) return null;

  const { content, messageCount, chunkCount } = getSessionContent(session, sessionId);

  if (!content.trim()) {
    console.log(`[retention] Session ${sessionId} has no content to parse, skipping`);
    return null;
  }

  const settings = getRetentionSettings();
  let model = settings.retention_lm_model;

  if (!model) {
    model = (await detectModel(settings.retention_lm_url)) || "";
    if (!model) throw new Error("No LLM model available — could not auto-detect");
  }

  const userContent = `Session: "${session.name}" (${session.type})
Created: ${session.created_at}
Archived: ${session.updated_at}

--- Session Content ---
${content}`;

  const result = await callLLM(settings.retention_lm_url, model, userContent);

  // Insert digest
  const digestId = nanoid(12);
  db.prepare(`
    INSERT INTO session_digests (id, session_name, session_type, summary, key_learnings, tags, session_created_at, session_archived_at, parsed_by, source_message_count, source_output_chunks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    digestId,
    session.name,
    session.type,
    result.summary,
    JSON.stringify(result.key_learnings),
    JSON.stringify(result.tags),
    session.created_at,
    session.updated_at,
    model,
    messageCount,
    chunkCount,
  );

  // Sync to FTS5
  try {
    db.prepare(
      "INSERT INTO session_digests_fts(rowid, session_name, summary, key_learnings, tags) VALUES ((SELECT rowid FROM session_digests WHERE id = ?), ?, ?, ?, ?)"
    ).run(digestId, session.name, result.summary, JSON.stringify(result.key_learnings), JSON.stringify(result.tags));
  } catch { /* FTS sync best-effort */ }

  // Emit atomic facts into knowledge_facts
  let factsEmitted = 0;
  for (const fact of result.facts) {
    if (!fact.category || !fact.key || !fact.value) continue;
    try {
      const factId = nanoid(12);
      db.prepare(`
        INSERT INTO knowledge_facts (id, scope, category, key, value, confidence, source_session_id, source_agent)
        VALUES (?, 'global', ?, ?, ?, 0.6, ?, 'retention-parser')
      `).run(factId, fact.category, fact.key, fact.value, sessionId);

      // Sync to FTS5
      try {
        db.prepare(
          "INSERT INTO knowledge_facts_fts(rowid, key, value, category) VALUES ((SELECT rowid FROM knowledge_facts WHERE id = ?), ?, ?, ?)"
        ).run(factId, fact.key, fact.value, fact.category);
      } catch { /* FTS sync best-effort */ }

      factsEmitted++;
    } catch (err) {
      console.warn(`[retention] Failed to emit fact: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[retention] Parsed session "${session.name}" → digest ${digestId}, ${factsEmitted} facts`);
  return { digestId, factsEmitted };
}

// ---------------------------------------------------------------------------
// Delete a session fully (PTY + cascade delete)
// ---------------------------------------------------------------------------

export function deleteSessionFully(sessionId: string): boolean {
  const result = db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  if (result.changes === 0) return false;

  destroyPty(sessionId);
  db.prepare("DELETE FROM terminal_output_events WHERE session_id = ?").run(sessionId);
  return true;
}

// ---------------------------------------------------------------------------
// Retention sweep — find expired archives, parse, delete
// ---------------------------------------------------------------------------

export async function runRetentionSweep(io?: Server): Promise<{
  processed: number;
  parsed: number;
  deleted: number;
  skipped: number;
  errors: string[];
}> {
  const settings = getRetentionSettings();
  const days = settings.archive_retention_days;

  const expired = db
    .prepare(
      "SELECT * FROM sessions WHERE archived = 1 AND updated_at < datetime('now', ? || ' days')"
    )
    .all(`-${days}`) as DbSession[];

  console.log(`[retention] Sweep: ${expired.length} archived session(s) past ${days}-day retention`);

  const result = { processed: 0, parsed: 0, deleted: 0, skipped: 0, errors: [] as string[] };

  for (const session of expired) {
    result.processed++;

    try {
      // Attempt LLM parse
      const parseResult = await parseSessionForKnowledge(session.id);
      if (parseResult) result.parsed++;

      // Delete regardless of parse result (content might have been empty)
      if (deleteSessionFully(session.id)) {
        result.deleted++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[retention] Failed to process session "${session.name}": ${msg}`);

      if (settings.retention_lm_unavailable_policy === "delete") {
        // Delete without parsing
        if (deleteSessionFully(session.id)) {
          result.deleted++;
          console.log(`[retention] Deleted "${session.name}" without parsing (policy: delete)`);
        }
      } else {
        // Keep for next sweep
        result.skipped++;
        console.log(`[retention] Keeping "${session.name}" for next sweep (policy: keep)`);
      }

      result.errors.push(`${session.name}: ${msg}`);
    }
  }

  // Record last run
  upsertState.run("last_retention_run", new Date().toISOString());

  // Notify clients if anything changed
  if (result.deleted > 0 && io) {
    io.emit("session_list_changed");
  }

  console.log(
    `[retention] Sweep complete: ${result.processed} processed, ${result.parsed} parsed, ${result.deleted} deleted, ${result.skipped} skipped`
  );

  return result;
}

// ---------------------------------------------------------------------------
// Scheduler — daily sweep
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
let sweepInterval: ReturnType<typeof setInterval> | null = null;

export function startRetentionScheduler(io: Server): void {
  if (!features.archiveRetention()) {
    console.log("[retention] Archive retention disabled (ANT_ENABLE_ARCHIVE_RETENTION=false)");
    return;
  }

  console.log("[retention] Scheduler started (daily sweep)");

  // Run initial sweep after a short delay (let server finish starting)
  setTimeout(() => {
    runRetentionSweep(io).catch((err) => {
      console.warn("[retention] Initial sweep failed:", err.message);
    });
  }, 30_000);

  // Then daily
  sweepInterval = setInterval(() => {
    runRetentionSweep(io).catch((err) => {
      console.warn("[retention] Scheduled sweep failed:", err.message);
    });
  }, SWEEP_INTERVAL_MS);
}

export function stopRetentionScheduler(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    console.log("[retention] Scheduler stopped");
  }
}
