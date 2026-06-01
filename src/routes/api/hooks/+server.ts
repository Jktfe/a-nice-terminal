// POST /api/hooks — no-op accept-and-drop endpoint.
//
// Diagnostic finding 2026-05-24 (Silent heroes yz4clwzvbm msg_awr2jtm2om):
// 1854 hits in /tmp/ant-server.log were POSTing to /api/hooks → 404.
// None of src/ or scripts/ POSTs here; the calls are from external
// hook-system clients (probably a Claude Code or webhook integration)
// pointing at a misconfigured URL. The 404 spam was making real signal
// hard to find in the log during server-hang investigation.
//
// This endpoint accepts any POST body and returns 204 No Content. The
// body is discarded — we don't trust unknown senders. If a future
// integration actually needs to deliver hook events, replace this with
// real handling + auth.

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  return new Response(null, { status: 204 });
};

// Allow GET probes too so a misconfigured caller doing GET-as-ping
// doesn't add to the 404 noise.
export const GET: RequestHandler = async () => {
  return new Response(null, { status: 204 });
};
