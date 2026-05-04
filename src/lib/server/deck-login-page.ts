export function renderDeckLogin(slug: string, opts: { status?: number; message?: string } = {}): Response {
  const message = opts.message
    ? `<p class="error">${escapeHtml(opts.message)}</p>`
    : '';
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ANT Deck access</title>
  <style>
    :root { color-scheme: dark light; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #111827; color: #f9fafb; }
    main { width: min(92vw, 420px); }
    h1 { font-size: 1.45rem; margin: 0 0 .5rem; }
    p { color: #cbd5e1; line-height: 1.5; margin: 0 0 1rem; }
    label { display: block; font-size: .875rem; color: #cbd5e1; margin-bottom: .4rem; }
    input { width: 100%; min-height: 44px; box-sizing: border-box; border: 1px solid #374151; border-radius: 8px; padding: 0 .8rem; background: #030712; color: #f9fafb; }
    button { min-height: 44px; margin-top: .75rem; border: 0; border-radius: 8px; padding: 0 1rem; background: #2563eb; color: #fff; font-weight: 700; }
    .error { color: #fecaca; background: #7f1d1d; border: 1px solid #ef4444; border-radius: 8px; padding: .7rem .8rem; }
  </style>
</head>
<body>
  <main>
    <h1>Access required</h1>
    <p>This deck is gated by an ANT room invite token.</p>
    ${message}
    <form method="POST" action="/deck/${encodeURIComponent(slug)}/login">
      <label for="token">Invite token</label>
      <input id="token" name="token" type="password" autocomplete="one-time-code" autofocus required />
      <button type="submit">View deck</button>
    </form>
  </main>
</body>
</html>`, {
    status: opts.status ?? 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
