import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");

describe("--version", () => {
  it("exits 0 and matches semver + sha pattern", () => {
    const result = spawnSync("node", [CLI, "--version"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^remoteant \d+\.\d+\.\d+ \([a-f0-9]+\)$/);
  });

  it("-v is an alias for --version", () => {
    const result = spawnSync("node", [CLI, "-v"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^remoteant \d+\.\d+\.\d+ \([a-f0-9]+\)$/);
  });
});
