import pkg from "../../package.json" with { type: "json" };
import { parseEnv } from "../env.ts";
import { antApiFetch } from "./http-client.ts";

export async function antStatus() {
  const health = await antApiFetch<{
    status: string;
    uptimeSeconds?: number;
    db?: { reachable?: boolean };
  }>("/api/health", { method: "GET", env: parseEnv() });
  return {
    daemonReachable: health.status === "ok" || health.status === "degraded",
    serverVersion: pkg.version,
    dbReachable: health.db?.reachable === true,
    uptimeSeconds: health.uptimeSeconds ?? 0,
  };
}
