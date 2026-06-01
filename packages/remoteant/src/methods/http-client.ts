import type { RemoteantEnv } from "../env.ts";

export class HttpError extends Error {
  constructor(public readonly statusCode: number, public readonly body: string) {
    super(`HTTP ${statusCode}: ${body}`);
  }
}

export async function antApiFetch<T>(
  path: string,
  init: RequestInit & { env: RemoteantEnv },
): Promise<T> {
  const url = new URL(path, init.env.ANT_SERVER_URL).toString();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.env.ANT_ADMIN_TOKEN) headers.set("authorization", `Bearer ${init.env.ANT_ADMIN_TOKEN}`);
  if (init.env.ANT_AS_HANDLE) headers.set("x-ant-as-handle", init.env.ANT_AS_HANDLE);

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new HttpError(response.status, await response.text());
  return await response.json() as T;
}
