import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");

function readOneLine(stdout: ReturnType<typeof spawn>["stdout"]): Promise<string> {
  return new Promise((resolve) => {
    stdout.once("data", (chunk: Buffer) => resolve(chunk.toString("utf-8").trim()));
  });
}

describe("error codes", () => {
  it("malformed JSON returns -32700 ParseError", async () => {
    const child = spawn("node", [CLI, "--mcp-stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write("this is not json\n");
    const line = await readOneLine(child.stdout);
    const response = JSON.parse(line);
    expect(response.error.code).toBe(-32700);
    child.kill("SIGTERM");
  });

  it("unknown method returns -32601 MethodNotFound", async () => {
    const child = spawn("node", [CLI, "--mcp-stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "foo.bar" }) + "\n");
    const line = await readOneLine(child.stdout);
    const response = JSON.parse(line);
    expect(response.error.code).toBe(-32601);
    child.kill("SIGTERM");
  });

  it("invalid jsonrpc envelope returns -32700", async () => {
    const child = spawn("node", [CLI, "--mcp-stdio"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write(JSON.stringify({ id: 1, method: "initialize" }) + "\n"); // missing jsonrpc field
    const line = await readOneLine(child.stdout);
    const response = JSON.parse(line);
    expect(response.error.code).toBe(-32700);
    child.kill("SIGTERM");
  });
});
