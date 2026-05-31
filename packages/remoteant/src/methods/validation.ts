export class InvalidParamsError extends Error {
  constructor(message: string) {
    super(`invalid params: ${message}`);
  }
}

function objectParams(params: unknown): Record<string, unknown> {
  if (params === undefined) return {};
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new InvalidParamsError("params must be an object");
  }
  return params as Record<string, unknown>;
}

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidParamsError(`${key} is required`);
  }
  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidParamsError(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalLimit(params: Record<string, unknown>, max = 500): number | undefined {
  const value = params.limit;
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > max) {
    throw new InvalidParamsError(`limit must be an integer between 1 and ${max}`);
  }
  return value;
}

export function validateRoomsListParams(params: unknown): { archived?: boolean; limit?: number } {
  const obj = objectParams(params);
  const archivedRaw = obj.archived;
  if (archivedRaw !== undefined && typeof archivedRaw !== "boolean") {
    throw new InvalidParamsError("archived must be boolean");
  }
  const limit = optionalLimit(obj);
  return {
    ...(archivedRaw !== undefined ? { archived: archivedRaw } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function validateRoomsGetParams(params: unknown): { roomId: string } {
  const obj = objectParams(params);
  return { roomId: requiredString(obj, "roomId") };
}

export function validateChatSendParams(params: unknown): { roomId: string; body: string; kind?: "human" | "agent" } {
  const obj = objectParams(params);
  const kind = obj.kind;
  if (kind !== undefined && kind !== "human" && kind !== "agent") {
    throw new InvalidParamsError("kind must be human or agent");
  }
  return {
    roomId: requiredString(obj, "roomId"),
    body: requiredString(obj, "body"),
    ...(kind !== undefined ? { kind } : {}),
  };
}

export function validateChatHistoryParams(params: unknown): { roomId: string; since?: string; limit?: number } {
  const obj = objectParams(params);
  const limit = optionalLimit(obj);
  return {
    roomId: requiredString(obj, "roomId"),
    ...(optionalString(obj, "since") ? { since: optionalString(obj, "since") } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function validatePlansShowParams(params: unknown): { planId: string } {
  const obj = objectParams(params);
  return { planId: requiredString(obj, "planId") };
}
