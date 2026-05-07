// Embedded static asset pipeline.
//
// We use Bun's import-attribute syntax (`with { type: 'text' }`) so the
// compiler packs each asset into the standalone executable as a string.
// At runtime we serve those strings directly — no fs reads, no `/$bunfs`
// path resolution. This also works in `bun run` mode (uncompiled) since
// Bun resolves the loader at import time.
//
// New asset → add an `import` here, add it to `STATIC_FILES`, ship.

// @ts-expect-error — Bun resolves these via the `text` loader; tsc shim in ./ui/assets.d.ts.
import indexHtml from './ui/index.html' with { type: 'text' };
// @ts-expect-error — Bun text loader for app.js.
import appJs    from './ui/app.js'      with { type: 'text' };
// @ts-expect-error — Bun text loader for style.css.
import styleCss from './ui/style.css'   with { type: 'text' };

const STATIC_FILES: Record<string, { body: string; mime: string }> = {
  'app.js':    { body: appJs,    mime: 'text/javascript; charset=utf-8' },
  'style.css': { body: styleCss, mime: 'text/css; charset=utf-8' },
};

const SECURITY_HEADERS: Record<string, string> = {
  'cross-origin-opener-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function renderShell(): string {
  return indexHtml as string;
}

export function serveStatic(subpath: string): Response {
  // Path-traversal proof: only flat filenames allowed.
  if (!/^[a-zA-Z0-9._-]+$/.test(subpath)) {
    return new Response(JSON.stringify({ error: 'invalid_path' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  const entry = STATIC_FILES[subpath];
  if (!entry) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  const headers = new Headers({ 'content-type': entry.mime });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  headers.set('cache-control', 'public, max-age=300');
  return new Response(entry.body, { status: 200, headers });
}
