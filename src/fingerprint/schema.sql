-- ANT Fingerprinting Pipeline — SQLite schema
-- File: src/fingerprint/schema.sql
-- Stored in a dedicated fingerprint.db (separate from ant.db)
-- to keep experiment data isolated from production session data.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- driver_specs: one row per agent driver configuration.
-- Describes how the runner injects prompts into a specific agent UI
-- (e.g. Claude Code via tmux send-keys, Cursor via AppleScript, etc.)
CREATE TABLE IF NOT EXISTS driver_specs (
  id          TEXT PRIMARY KEY,                -- e.g. "claude-code-tmux"
  name        TEXT NOT NULL,                   -- human label
  driver_type TEXT NOT NULL                    -- 'tmux' | 'applescript' | 'http'
    CHECK(driver_type IN ('tmux', 'applescript', 'http')),
  config      TEXT NOT NULL DEFAULT '{}',      -- JSON: tmux session, pane, endpoint, etc.
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- probe_output: one row per probe × run × driver.
-- Stores the raw and normalised terminal output produced in response to each probe.
CREATE TABLE IF NOT EXISTS probe_output (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,                -- groups all probes in one runner invocation
  driver_id      TEXT NOT NULL REFERENCES driver_specs(id) ON DELETE CASCADE,
  probe_id       TEXT NOT NULL,                -- P01–P10
  event_class    TEXT NOT NULL,                -- mirrors probe_prompts.json event_class
  prompt_sent    TEXT NOT NULL,                -- verbatim prompt injected
  raw_output     TEXT,                         -- unsanitised tmux control-mode capture
  normalised     TEXT,                         -- ANSI-stripped, whitespace-collapsed text
  events_json    TEXT,                         -- JSON array of NormalisedEvent objects
  duration_ms    INTEGER,                      -- wall-clock ms from injection to idle
  exit_signal    TEXT,                         -- 'idle_timeout' | 'prompt_detected' | 'error'
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- probe_screenshots: optional terminal snapshots taken during a probe run.
-- Stored as base64-encoded PNG to keep everything in one file.
CREATE TABLE IF NOT EXISTS probe_screenshots (
  id          TEXT PRIMARY KEY,
  output_id   TEXT NOT NULL REFERENCES probe_output(id) ON DELETE CASCADE,
  taken_at_ms INTEGER NOT NULL,               -- ms offset from probe injection
  pane_id     TEXT,                           -- tmux pane identifier
  width_cols  INTEGER,
  height_rows INTEGER,
  data_b64    TEXT NOT NULL                   -- base64 PNG
);

-- FTS5 index over normalised output for cross-run text search
CREATE VIRTUAL TABLE IF NOT EXISTS probe_output_fts USING fts5(
  probe_id,
  event_class,
  normalised,
  content='probe_output',
  content_rowid='rowid',
  tokenize='porter ascii'
);

-- Keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS probe_output_fts_insert
  AFTER INSERT ON probe_output BEGIN
    INSERT INTO probe_output_fts(rowid, probe_id, event_class, normalised)
    VALUES (new.rowid, new.probe_id, new.event_class, new.normalised);
  END;

CREATE TRIGGER IF NOT EXISTS probe_output_fts_delete
  AFTER DELETE ON probe_output BEGIN
    INSERT INTO probe_output_fts(probe_output_fts, rowid, probe_id, event_class, normalised)
    VALUES ('delete', old.rowid, old.probe_id, old.event_class, old.normalised);
  END;

CREATE TRIGGER IF NOT EXISTS probe_output_fts_update
  AFTER UPDATE ON probe_output BEGIN
    INSERT INTO probe_output_fts(probe_output_fts, rowid, probe_id, event_class, normalised)
    VALUES ('delete', old.rowid, old.probe_id, old.event_class, old.normalised);
    INSERT INTO probe_output_fts(rowid, probe_id, event_class, normalised)
    VALUES (new.rowid, new.probe_id, new.event_class, new.normalised);
  END;
