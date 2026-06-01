import { makeErrorResponse, makeSuccessResponse, ErrorCodes } from "../mcp-stdio/errors.ts";
import type { JsonRpcRequest } from "../mcp-stdio/methods.ts";
import { antChatHistory } from "./chat-history.ts";
import { antChatSend } from "./chat-send.ts";
import { HttpError } from "./http-client.ts";
import { antPlansShow } from "./plans-show.ts";
import { antRoomsGet } from "./rooms-get.ts";
import { antRoomsList } from "./rooms-list.ts";
import { antStatus } from "./status.ts";
import { InvalidParamsError } from "./validation.ts";

type MethodHandler = (params: unknown) => Promise<unknown> | unknown;

export const b2MethodHandlers = new Map<string, MethodHandler>([
  ["ant.rooms.list", antRoomsList],
  ["ant.rooms.get", antRoomsGet],
  ["ant.chat.send", antChatSend],
  ["ant.chat.history", antChatHistory],
  ["ant.plans.show", antPlansShow],
  ["ant.status", antStatus],
]);

export function b2ToolDefinitions() {
  return [
    { name: "ant.rooms.list", description: "List ANT rooms", inputSchema: { type: "object", properties: { archived: { type: "boolean" }, limit: { type: "number" } } } },
    { name: "ant.rooms.get", description: "Get one ANT room", inputSchema: { type: "object", required: ["roomId"], properties: { roomId: { type: "string" } } } },
    { name: "ant.chat.send", description: "Send a chat message", inputSchema: { type: "object", required: ["roomId", "body"], properties: { roomId: { type: "string" }, body: { type: "string" }, kind: { enum: ["human", "agent"] } } } },
    { name: "ant.chat.history", description: "Read recent chat history", inputSchema: { type: "object", required: ["roomId"], properties: { roomId: { type: "string" }, since: { type: "string" }, limit: { type: "number" } } } },
    { name: "ant.plans.show", description: "Show plan events grouped for MCP clients", inputSchema: { type: "object", required: ["planId"], properties: { planId: { type: "string" } } } },
    { name: "ant.status", description: "Read ANT daemon status", inputSchema: { type: "object", properties: {} } },
  ];
}

export async function dispatchB2Method(request: JsonRpcRequest, handler: MethodHandler) {
  try {
    return makeSuccessResponse(request.id ?? null, await handler(request.params));
  } catch (error) {
    return makeErrorResponse(request.id ?? null, mapMethodError(error));
  }
}

function mapMethodError(error: unknown) {
  if (error instanceof InvalidParamsError) {
    return { code: ErrorCodes.InvalidParams, message: error.message };
  }
  if (error instanceof HttpError) {
    if (error.statusCode === 401 || error.statusCode === 403) return { code: -32002, message: "auth failure" };
    if (error.statusCode === 429) return { code: -32003, message: "rate-limited" };
    if (error.statusCode === 404) return { code: ErrorCodes.InvalidParams, message: "resource not found" };
    if (error.statusCode >= 500) return { code: ErrorCodes.InternalError, message: "internal error", data: { upstream: error.body } };
    return { code: ErrorCodes.InvalidParams, message: error.body };
  }
  if (error instanceof TypeError) {
    return { code: ErrorCodes.ServerError, message: "daemon unreachable" };
  }
  return { code: ErrorCodes.InternalError, message: error instanceof Error ? error.message : String(error) };
}
