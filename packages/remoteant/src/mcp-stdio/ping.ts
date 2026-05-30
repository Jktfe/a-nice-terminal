import { parseEnv } from "../env.ts";
import { makeSuccessResponse } from "./errors.ts";

export async function handlePing(request: { id: number | string | null }) {
  const env = parseEnv();
  const healthUrl = new URL("/api/health", env.ANT_SERVER_URL).toString();

  let daemonReachable = false;
  try {
    const res = await fetch(healthUrl, { method: "GET" });
    daemonReachable = res.ok;
  } catch {
    daemonReachable = false;
  }

  return makeSuccessResponse(request.id, {
    ok: true,
    daemonReachable,
    daemonUrl: env.ANT_SERVER_URL,
  });
}
