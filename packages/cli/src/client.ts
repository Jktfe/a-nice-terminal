export interface ClientConfig {
  server: string;
  apiKey?: string;
}

export interface Client {
  get(path: string): Promise<any>;
  post(path: string, body?: any): Promise<any>;
  patch(path: string, body?: any): Promise<any>;
  del(path: string): Promise<any>;
  config: ClientConfig;
}

export function createClient(config: ClientConfig): Client {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["X-API-Key"] = config.apiKey;
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  async function request(method: string, path: string, body?: any): Promise<any> {
    const url = `${config.server}${path}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message: string;
      try {
        message = JSON.parse(text).error || text;
      } catch {
        message = text || `HTTP ${res.status}`;
      }
      const err = new Error(message) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
    del: (path) => request("DELETE", path),
    config,
  };
}
