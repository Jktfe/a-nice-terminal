import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");

describe("version build isolation", () => {
  it("reports the current git HEAD short SHA, not a stale constant", () => {
    const result = spawnSync("node", [CLI, "--version"], { encoding: "utf-8" });
    expect(result.status).toBe(0);

    const match = result.stdout.trim().match(/^remoteant \d+\.\d+\.\d+ \(([a-f0-9]+)\)$/);
    expect(match).not.toBeNull();

    const versionSha = match![1];
    const headSha = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf-8",
      cwd: join(import.meta.dirname, ".."),
    }).stdout.trim();

    expect(versionSha).toBe(headSha);
  });
});
