// Server-to-server HTTP(S) helper that accepts self-signed certs. Used by the
// remote-rooms proxy: many ANT instances run on localhost or LAN with self-
// signed TLS, so the standard fetch (strict cert verification) would fail.
//
// Built on Node's `https`/`http` rather than undici/Agent so we don't pin to a
// specific undici version (this repo hit a webidl mismatch on recent versions).
//
// Caller picks ONE of `.text()` or `.body` — the underlying Node IncomingMessage
// is single-use, so calling both is undefined behaviour.

import * as http from 'node:http';
import * as https from 'node:https';
import { Readable } from 'node:stream';

export interface InsecureResponse {
  status: number;
  ok: boolean;
  body: ReadableStream | null;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface InsecureRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export function insecureFetch(url: string | URL, init: InsecureRequestInit = {}): Promise<InsecureResponse> {
  const u = typeof url === 'string' ? new URL(url) : url;
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;
  const opts: any = {
    method: init.method || 'GET',
    headers: init.headers || {},
    ...(isHttps ? { rejectUnauthorized: false } : {}),
  };

  return new Promise((resolve, reject) => {
    const req = lib.request(u, opts, (res) => {
      const status = res.statusCode || 0;
      const headers = res.headers;
      const get = (name: string): string | null => {
        const v = headers[name.toLowerCase()];
        if (Array.isArray(v)) return v.join(', ');
        return v ?? null;
      };
      let consumedAs: 'body' | 'text' | null = null;
      const responseShim: InsecureResponse = {
        status,
        ok: status >= 200 && status < 300,
        get body() {
          if (consumedAs === 'text') {
            throw new Error('insecureFetch: body already consumed via text()');
          }
          consumedAs = 'body';
          return Readable.toWeb(res) as unknown as ReadableStream;
        },
        headers: { get },
        async text() {
          if (consumedAs === 'body') {
            throw new Error('insecureFetch: stream already consumed via body');
          }
          consumedAs = 'text';
          const chunks: Buffer[] = [];
          for await (const chunk of res) chunks.push(chunk as Buffer);
          return Buffer.concat(chunks).toString('utf-8');
        },
      };
      resolve(responseShim);
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
