// JSON-RPC 2.0 error codes per E1 §4.4

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  ServerError: -32001,
} as const;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export function makeErrorResponse(id: number | string | null, error: JsonRpcError) {
  return {
    jsonrpc: "2.0",
    id,
    error,
  };
}

export function makeSuccessResponse(id: number | string | null, result: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}
