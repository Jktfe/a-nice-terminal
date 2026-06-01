import { VERSION } from "../version.ts";
import { makeSuccessResponse } from "./errors.ts";

export function handleInitialize(request: { id: number | string | null; params?: { protocolVersion?: string } }) {
  const clientProtocolVersion = request.params?.protocolVersion ?? "2025-06-18";
  return makeSuccessResponse(request.id, {
    protocolVersion: clientProtocolVersion,
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: {
      name: "remoteant",
      version: VERSION,
    },
  });
}
