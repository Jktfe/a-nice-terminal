interface Ctx { serverUrl: string; apiKey: string; json: boolean; }

async function request(ctx: Ctx, method: string, path: string, body?: any): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ctx.apiKey) headers['Authorization'] = `Bearer ${ctx.apiKey}`;

  const res = await fetch(`${ctx.serverUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // @ts-ignore — Bun supports this for self-signed certs
    tls: { rejectUnauthorized: false },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (ctx: Ctx, path: string) => request(ctx, 'GET', path),
  post: (ctx: Ctx, path: string, body: any) => request(ctx, 'POST', path, body),
  patch: (ctx: Ctx, path: string, body: any) => request(ctx, 'PATCH', path, body),
  del: (ctx: Ctx, path: string) => request(ctx, 'DELETE', path),
};
