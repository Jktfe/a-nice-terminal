import { error, type RequestEvent } from '@sveltejs/kit';
import { cspForTrustMode, injectSafeBanner, injectTrustedReloader, readDeckMeta, type DeckMeta } from '$lib/server/decks';
import { ensureDeckWatcher } from '$lib/server/deck-watcher';
import { hasDeckCookie } from '$lib/server/deck-view-auth';
import { renderDeckLogin } from '$lib/server/deck-login-page';
import { isDeckAdmin } from '$lib/server/deck-auth';
import { roomScope } from '$lib/server/room-scope';

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

function inboundHeaders(response: Response, deck: DeckMeta): Headers {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    // Drop any CSP upstream tried to set — the deck dev server is the
    // untrusted side; CSP is owned by the proxy and computed from the
    // deck's trust_mode (B1 of main-app-improvements-2026-05-10).
    if (key.toLowerCase() === 'content-security-policy') return;
    if (key.toLowerCase() === 'content-security-policy-report-only') return;
    headers.set(key, value);
  });
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Security-Policy', cspForTrustMode(deck.trust_mode));
  headers.set('X-Deck-Trust-Mode', deck.trust_mode);
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

function isLoopbackDeckHost(event: RequestEvent): boolean {
  const hostname = event.url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return hostname === 'localhost' || hostname === '::1' || hostname === '127.0.0.1' || hostname.startsWith('127.');
}

function hasDeckViewAccess(event: RequestEvent, slug: string, deck: DeckMeta): boolean {
  if (hasDeckCookie(event.cookies, slug, deck)) return true;
  if (isDeckAdmin(event)) return true;
  const scope = roomScope(event);
  if (scope && deck.allowed_room_ids.includes(scope.roomId)) return true;
  // Local operator deck previews are same-machine development artefacts. Keep
  // remote/Tailscale/public hosts on the invite-cookie path, but do not make
  // the owner paste an invite when opening https://127.0.0.1:6458/deck/...
  return isLoopbackDeckHost(event);
}

async function proxyDeck(event: RequestEvent): Promise<Response> {
  const slug = slugParam(event);
  const deck = readDeckMeta(slug);
  if (!deck) throw error(404, 'deck not found');
  if (!hasDeckViewAccess(event, slug, deck)) return renderDeckLogin(slug);
  // B3 of main-app-improvements-2026-05-10 — lazy-start a chokidar
  // watcher on first proxy request for this deck. Idempotent.
  ensureDeckWatcher(deck);
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

  const headers = inboundHeaders(response, deck);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    let html = rewriteHtml(slug, await response.text());
    if (deck.trust_mode === 'safe') {
      html = injectSafeBanner(slug, html);
    } else {
      html = injectTrustedReloader(slug, html);
    }
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
