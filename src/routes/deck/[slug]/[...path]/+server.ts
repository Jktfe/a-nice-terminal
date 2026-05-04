import { error, type RequestEvent } from '@sveltejs/kit';
import { readDeckMeta } from '$lib/server/decks';
import { hasDeckCookie } from '$lib/server/deck-view-auth';
import { renderDeckLogin } from '$lib/server/deck-login-page';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

function pathParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).path ?? '');
}

function proxiedPath(path: string): string {
  const clean = path.replace(/^\/+/, '');
  return clean ? `/${clean}` : '/';
}

function outboundHeaders(event: RequestEvent, port: number): Headers {
  const headers = new Headers();
  event.request.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    if (key.toLowerCase() === 'host') return;
    if (key.toLowerCase() === 'cookie') return;
    headers.set(key, value);
  });
  headers.set('host', `localhost:${port}`);
  return headers;
}

function inboundHeaders(response: Response): Headers {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    headers.set(key, value);
  });
  headers.set('Cache-Control', 'no-store');
  return headers;
}

function rewriteHtml(slug: string, html: string): string {
  const prefix = `/deck/${encodeURIComponent(slug)}`;
  return html
    .replaceAll('href="/', `href="${prefix}/`)
    .replaceAll('src="/', `src="${prefix}/`)
    .replaceAll('action="/', `action="${prefix}/`)
    .replaceAll('from "/', `from "${prefix}/`)
    .replaceAll("from '/", `from '${prefix}/`)
    .replaceAll('import("/', `import("${prefix}/`)
    .replaceAll("import('/", `import('${prefix}/`);
}

async function proxyDeck(event: RequestEvent): Promise<Response> {
  const slug = slugParam(event);
  const deck = readDeckMeta(slug);
  if (!deck) throw error(404, 'deck not found');
  if (!hasDeckCookie(event.cookies, slug, deck)) return renderDeckLogin(slug);
  if (!deck.dev_port) {
    return new Response(`Deck dev server is not registered. Start it in ${deck.deck_dir} and PATCH dev_port.`, {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const target = new URL(`http://127.0.0.1:${deck.dev_port}${proxiedPath(pathParam(event))}`);
  target.search = event.url.search;
  const response = await fetch(target, {
    method: event.request.method,
    headers: outboundHeaders(event, deck.dev_port),
    body: ['GET', 'HEAD'].includes(event.request.method) ? undefined : event.request.body,
    duplex: 'half',
  } as RequestInit & { duplex?: 'half' });

  const headers = inboundHeaders(response);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const html = rewriteHtml(slug, await response.text());
    headers.delete('content-length');
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const GET = proxyDeck;
export const HEAD = proxyDeck;
export const POST = proxyDeck;
export const PUT = proxyDeck;
export const PATCH = proxyDeck;
export const DELETE = proxyDeck;
export const OPTIONS = proxyDeck;
