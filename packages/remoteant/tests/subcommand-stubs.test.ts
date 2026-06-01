import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");

describe("subcommand stubs", () => {
  it.each(["install", "serve", "supervise"] as const)(
    "%s exits 64 with not-yet-implemented message",
    (cmd) => {
      const result = spawnSync("node", [CLI, cmd], { encoding: "utf-8" });
      expect(result.status).toBe(64);
      expect(result.stderr.trim()).toBe(`${cmd}: not yet implemented in A1`);
    }
  );

  it("unknown subcommand exits 64 with usage hint", () => {
    const result = spawnSync("node", [CLI, "foo"], { encoding: "utf-8" });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("usage:");
  });

  it("no args exits 64 with usage hint", () => {
    const result = spawnSync("node", [CLI], { encoding: "utf-8" });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain("usage:");
  });
});
