/**
 * capture-ingest — watches ant-capture log files and ingests into SQLite.
 *
 * For each active session:
 *   - Tails the .log file (raw terminal output) → terminal_output_events
 *   - Tails the .events file (shell hook NDJSON) → command_events
 *
 * Resilient by design:
 *   - Tracks cursor position per session in SQLite
 *   - If antd restarts, picks up from where it left off
 *   - If the log file is truncated/rotated, detects and resets
 *
 * Usage:
 *   import { CaptureIngest } from './capture-ingest.js';
 *   const ingest = new CaptureIngest(db, captureDir);
 *   ingest.start();
 *   // ... later
 *   ingest.stop();
 */

import { watch, statSync, createReadStream, readdirSync, existsSync } from "fs";
import { createInterface } from "readline";
import path from "path";
import type Database from "better-sqlite3";

interface SessionCursor {
  logOffset: number; // bytes read from .log file
  eventOffset: number; // bytes read from .events file
}

export class CaptureIngest {
  private db: Database.Database;
  private captureDir: string;
  private watchers = new Map<string, ReturnType<typeof setInterval>>();
  private cursors = new Map<string, SessionCursor>();
  private dirWatcher: ReturnType<typeof watch> | null = null;

  // Prepared statements
  private insertOutput: Database.Statement;
  private insertEvent: Database.Statement;
  private getMaxChunk: Database.Statement;
  private getCursor: Database.Statement;
  private setCursor: Database.Statement;
  private getSession: Database.Statement;

  constructor(db: Database.Database, captureDir: string) {
    this.db = db;
    this.captureDir = captureDir;

    // Ensure capture cursor table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS capture_cursors (
        session_id TEXT PRIMARY KEY,
        log_offset INTEGER NOT NULL DEFAULT 0,
        event_offset INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Extend command_events with capture-specific columns if missing
    try { db.exec(`ALTER TABLE command_events ADD COLUMN start_chunk INTEGER DEFAULT NULL`); } catch {}
    try { db.exec(`ALTER TABLE command_events ADD COLUMN end_chunk INTEGER DEFAULT NULL`); } catch {}

    // Add FTS5 on command_events if not exists
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS command_events_fts USING fts5(
          command, output,
          content=command_events, content_rowid=rowid
        );
      `);
    } catch {
      // Already exists
    }

    this.insertOutput = db.prepare(
      "INSERT OR REPLACE INTO terminal_output_events (session_id, chunk_index, data) VALUES (?, ?, ?)"
    );

    this.insertEvent = db.prepare(`
      INSERT OR REPLACE INTO command_events (id, session_id, command, exit_code, started_at, completed_at, duration_ms, cwd, detection_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'shell_hook')
    `);

    this.getMaxChunk = db.prepare(
      "SELECT COALESCE(MAX(chunk_index), -1) AS max_index FROM terminal_output_events WHERE session_id = ?"
    );

    this.getCursor = db.prepare(
      "SELECT log_offset, event_offset FROM capture_cursors WHERE session_id = ?"
    );

    this.setCursor = db.prepare(`
      INSERT OR REPLACE INTO capture_cursors (session_id, log_offset, event_offset, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `);

    this.getSession = db.prepare(
      "SELECT id FROM sessions WHERE id = ?"
    );
  }

  /**
   * Start watching the capture directory for active sessions.
   */
  start(): void {
    // Scan for existing sessions on startup (catch-up after restart)
    this.scanExistingSessions();

    // Watch for new session files
    if (existsSync(this.captureDir)) {
      this.dirWatcher = watch(this.captureDir, (eventType, filename) => {
        if (!filename) return;
        if (filename.endsWith(".log") || filename.endsWith(".events")) {
          const sessionId = filename.replace(/\.(log|events)$/, "");
          if (!this.watchers.has(sessionId)) {
            this.startSessionWatch(sessionId);
          }
        }
      });
    }
  }

  /**
   * Stop all watchers.
   */
  stop(): void {
    this.dirWatcher?.close();
    this.dirWatcher = null;
    for (const [sessionId, interval] of this.watchers) {
      clearInterval(interval);
    }
    this.watchers.clear();
  }

  /**
   * Scan capture directory for existing sessions that need catch-up.
   */
  private scanExistingSessions(): void {
    if (!existsSync(this.captureDir)) return;
    const files = readdirSync(this.captureDir);
    const sessionIds = new Set<string>();
    for (const file of files) {
      if (file.endsWith(".log") || file.endsWith(".events")) {
        sessionIds.add(file.replace(/\.(log|events|meta|cursor)$/, ""));
      }
    }
    for (const sessionId of sessionIds) {
      this.startSessionWatch(sessionId);
    }
  }

  /**
   * Start watching a specific session's log and event files.
   */
  private startSessionWatch(sessionId: string): void {
    if (this.watchers.has(sessionId)) return;

    // Load cursor from DB
    const row = this.getCursor.get(sessionId) as { log_offset: number; event_offset: number } | undefined;
    this.cursors.set(sessionId, {
      logOffset: row?.log_offset ?? 0,
      eventOffset: row?.event_offset ?? 0,
    });

    // Poll every 500ms — simpler and more reliable than fs.watch for growing files
    const interval = setInterval(() => {
      this.ingestLog(sessionId);
      this.ingestEvents(sessionId);
    }, 500);

    this.watchers.set(sessionId, interval);

    // Immediate first ingest (catch up)
    this.ingestLog(sessionId);
    this.ingestEvents(sessionId);
  }

  /**
   * Ingest new data from a session's .log file (raw terminal output).
   */
  private ingestLog(sessionId: string): void {
    const logFile = path.join(this.captureDir, `${sessionId}.log`);
    if (!existsSync(logFile)) return;

    const cursor = this.cursors.get(sessionId)!;
    const stat = statSync(logFile);

    // Detect truncation (file smaller than our cursor)
    if (stat.size < cursor.logOffset) {
      cursor.logOffset = 0;
    }

    // Nothing new
    if (stat.size <= cursor.logOffset) return;

    // Read new bytes
    const fd = require("fs").openSync(logFile, "r");
    const bytesToRead = stat.size - cursor.logOffset;
    const buffer = Buffer.alloc(bytesToRead);
    require("fs").readSync(fd, buffer, 0, bytesToRead, cursor.logOffset);
    require("fs").closeSync(fd);

    // Get current max chunk index
    const maxRow = this.getMaxChunk.get(sessionId) as { max_index: number };
    let chunkIndex = maxRow.max_index + 1;

    // Store in chunks (~4KB each, matching pty-manager pattern)
    const CHUNK_SIZE = 4096;
    const data = buffer.toString("utf-8");
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      this.insertOutput.run(sessionId, chunkIndex++, chunk);
    }

    // Update cursor
    cursor.logOffset = stat.size;
    this.setCursor.run(sessionId, cursor.logOffset, cursor.eventOffset);
  }

  /**
   * Ingest new data from a session's .events file (NDJSON from shell hooks).
   */
  private ingestEvents(sessionId: string): void {
    const eventsFile = path.join(this.captureDir, `${sessionId}.events`);
    if (!existsSync(eventsFile)) return;

    const cursor = this.cursors.get(sessionId)!;
    const stat = statSync(eventsFile);

    if (stat.size < cursor.eventOffset) {
      cursor.eventOffset = 0;
    }
    if (stat.size <= cursor.eventOffset) return;

    // Read new bytes
    const fd = require("fs").openSync(eventsFile, "r");
    const bytesToRead = stat.size - cursor.eventOffset;
    const buffer = Buffer.alloc(bytesToRead);
    require("fs").readSync(fd, buffer, 0, bytesToRead, cursor.eventOffset);
    require("fs").closeSync(fd);

    const lines = buffer.toString("utf-8").split("\n").filter(Boolean);
    const pendingCommands = new Map<string, any>(); // command text → start event

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        this.processEvent(sessionId, event, pendingCommands);
      } catch {
        // Skip malformed lines
      }
    }

    cursor.eventOffset = stat.size;
    this.setCursor.run(sessionId, cursor.logOffset, cursor.eventOffset);
  }

  /**
   * Process a single shell hook event.
   */
  private processEvent(sessionId: string, event: any, pending: Map<string, any>): void {
    if (event.event === "command_start") {
      pending.set(event.command, event);
    } else if (event.event === "command_end") {
      // Try to find matching start
      // command_end may not include the command text — match by session
      const startEvent = event.command ? pending.get(event.command) : null;
      const startedAt = startEvent
        ? new Date(startEvent.ts).toISOString()
        : new Date(event.ts - (event.duration_ms || 0)).toISOString();
      const completedAt = new Date(event.ts).toISOString();

      const id = `${sessionId}-${event.ts}`;
      this.insertEvent.run(
        id,
        sessionId,
        startEvent?.command || event.command || "(unknown)",
        event.exit_code ?? null,
        startedAt,
        completedAt,
        event.duration_ms ?? null,
        event.cwd ?? null,
      );

      if (startEvent) {
        pending.delete(startEvent.command);
      }
    }
  }

  /**
   * Get ingestion stats for a session.
   */
  getStats(sessionId: string): { logOffset: number; eventOffset: number; chunks: number } | null {
    const cursor = this.cursors.get(sessionId);
    if (!cursor) return null;
    const maxRow = this.getMaxChunk.get(sessionId) as { max_index: number };
    return {
      logOffset: cursor.logOffset,
      eventOffset: cursor.eventOffset,
      chunks: maxRow.max_index + 1,
    };
  }
}
