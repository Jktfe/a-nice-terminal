import { createInterface } from "node:readline";
import { writeLogLine } from "../log.ts";
import { makeErrorResponse, ErrorCodes } from "./errors.ts";
import { dispatch, type JsonRpcRequest } from "./methods.ts";

export async function runMcpStdioAdapter() {
  writeLogLine("MCP stdio adapter started");

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let request: JsonRpcRequest;
    try {
      const parsed = JSON.parse(line);
      if (parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
        throw new Error("Invalid JSON-RPC envelope");
      }
      request = parsed as JsonRpcRequest;
    } catch (err) {
      writeLogLine(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
      const response = makeErrorResponse(null, {
        code: ErrorCodes.ParseError,
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
      process.stdout.write(JSON.stringify(response) + "\n");
      continue;
    }

    try {
      const result = await dispatch(request);
      // Notifications have no id — no response written
      if (request.id !== undefined && request.id !== null) {
        process.stdout.write(JSON.stringify(result) + "\n");
      }
    } catch (err) {
      writeLogLine(`Handler error for ${request.method}: ${err instanceof Error ? err.message : String(err)}`);
      const response = makeErrorResponse(request.id ?? null, {
        code: ErrorCodes.InternalError,
        message: err instanceof Error ? err.message : String(err),
      });
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  }
}
