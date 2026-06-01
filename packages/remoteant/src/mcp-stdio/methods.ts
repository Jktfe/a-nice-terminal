import { makeSuccessResponse, makeErrorResponse, ErrorCodes } from "./errors.ts";
import { handleInitialize } from "./initialize.ts";
import { handlePing } from "./ping.ts";
import type { RemoteantTransport } from "../transport/index.ts";
import { b2MethodHandlers, b2ToolDefinitions, dispatchB2Method } from "../methods/index.ts";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
};

export type Handler = (request: JsonRpcRequest) => unknown | Promise<unknown>;

const registry = new Map<string, Handler>();

registry.set("initialize", (req) => handleInitialize({ id: req.id ?? null, params: req.params as { protocolVersion?: string } }));

registry.set("ant.ping", (req) => handlePing({ id: req.id ?? null, transport: currentTransport }));

for (const [method, handler] of b2MethodHandlers) {
  registry.set(method, (req) => dispatchB2Method(req, handler));
}

registry.set("tools/list", (req) =>
  makeSuccessResponse(req.id ?? null, {
    tools: [
      {
        name: "ant.ping",
        description: "Probe the ANT daemon health endpoint",
        inputSchema: { type: "object", properties: {} },
      },
      ...b2ToolDefinitions(),
    ],
  })
);

export function dispatch(request: JsonRpcRequest): unknown | Promise<unknown> {
  const handler = registry.get(request.method);
  if (!handler) {
    return makeErrorResponse(request.id ?? null, {
      code: ErrorCodes.MethodNotFound,
      message: `Method not found: ${request.method}`,
    });
  }
  return handler(request);
}

let currentTransport: RemoteantTransport | undefined;

export function setCurrentTransport(transport: RemoteantTransport | undefined): void {
  currentTransport = transport;
}
