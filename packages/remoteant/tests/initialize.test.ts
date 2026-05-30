import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");

function readOneLine(stdout: ReturnType<typeof spawn>["stdout"]): Promise<string> {
  return new Promise((resolve) => {
    stdout.once("data", (chunk: Buffer) => resolve(chunk.toString("utf-8").trim()));
  });
}

describe("MCP initialize", () => {
  it("returns serverInfo.name === 'remoteant' with semver version", async () => {
    const child = spawn("node", [CLI, "--mcp-stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    const reqId = 1;
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: reqId,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        clientInfo: { name: "test", version: "0.0.0" },
      },
    }) + "\n");

    const line = await readOneLine(child.stdout);
    const response = JSON.parse(line);

    expect(response.id).toBe(reqId);
    expect(response.result.serverInfo.name).toBe("remoteant");
    expect(response.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+(-\w+)?$/);
    expect(response.result.protocolVersion).toBe("2025-06-18");
    child.kill("SIGTERM");
  });

  it("accepts notifications/initialized without response", async () => {
    const child = spawn("node", [CLI, "--mcp-stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }) + "\n");

    // Give it a moment; no response should be written
    await new Promise((r) => setTimeout(r, 100));

    // Since there's no response, reading one line would hang.
    // We just verify the process is still alive and hasn't crashed.
    expect(child.exitCode).toBeNull();
    child.kill("SIGTERM");
  });

  it("tools/list returns ant.ping as the only tool", async () => {
    const child = spawn("node", [CLI, "--mcp-stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }) + "\n");

    const line = await readOneLine(child.stdout);
    const response = JSON.parse(line);

    expect(response.id).toBe(2);
    expect(response.result.tools).toHaveLength(1);
    expect(response.result.tools[0].name).toBe("ant.ping");
    child.kill("SIGTERM");
  });
});
