import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// E1 §3.4 / E1-F — rotating file writer at ~/Library/Logs/antchat/remoteant.log
// Rotation: 5MB per file, 3-file ring.

const LOG_DIR = join(homedir(), "Library", "Logs", "antchat");
const LOG_FILE = join(LOG_DIR, "remoteant.log");
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 3;

function ensureDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function rotateIfNeeded() {
  if (!existsSync(LOG_FILE)) return;
  const stats = statSync(LOG_FILE);
  if (stats.size < MAX_SIZE) return;

  // Rotate ring: .log.2 → delete, .log.1 → .log.2, .log → .log.1
  const log2 = LOG_FILE + ".2";
  if (existsSync(log2)) {
    try { unlinkSync(log2); } catch { /* ignore */ }
  }
  const log1 = LOG_FILE + ".1";
  if (existsSync(log1)) {
    try { renameSync(log1, log2); } catch { /* ignore */ }
  }
  try { renameSync(LOG_FILE, log1); } catch { /* ignore */ }
}

export function writeLogLine(line: string) {
  ensureDir();
  rotateIfNeeded();
  const timestamp = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${timestamp}] ${line}\n`, { encoding: "utf-8" });
}
