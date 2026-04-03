import fs from "node:fs";

export function writePid(pidFile: string): void {
  fs.writeFileSync(pidFile, String(process.pid), "utf8");
}

export function readPid(pidFile: string): number | null {
  try {
    const raw = fs.readFileSync(pidFile, "utf8").trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function removePid(pidFile: string): void {
  try {
    fs.unlinkSync(pidFile);
  } catch {
    // Ignore — file may already be gone
  }
}
