import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");

function readOneLine(stdout: ReturnType<typeof spawn>["stdout"]): Promise<string> {
  return new Promise((resolve) => {
    stdout.once("data", (chunk: Buffer) => resolve(chunk.toString("utf-8").trim()));
  });
}

describe("ant.ping", () => {
  it("returns ok, daemonReachable boolean, and daemonUrl string", async () => {
    const child = spawn("node", [CLI, "--mcp-stdio"], { stdio: ["pipe", "pipe", "pipe"] });

    // First do initialize (required before other methods in real MCP, but our adapter allows ping directly)
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } },
    }) + "\n");
    await readOneLine(child.stdout); // consume initialize response

    // Now ping
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ant.ping",
    }) + "\n");

    const line = await readOneLine(child.stdout);
    const response = JSON.parse(line);

    expect(response.id).toBe(1);
    expect(response.result.ok).toBe(true);
    expect(typeof response.result.daemonReachable).toBe("boolean");
    expect(typeof response.result.daemonUrl).toBe("string");
    child.kill("SIGTERM");
  });
});
