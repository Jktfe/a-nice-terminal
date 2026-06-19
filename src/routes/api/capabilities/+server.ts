/**
 * GET /api/capabilities
 * OPTIONS /api/capabilities
 *
 * Public, no-auth tier discovery endpoint.
 * Returns the server's tier, available features, and limits.
 *
 * CORS-enabled: this endpoint is accessed cross-origin by native app
 * webviews (Tauri at :1420 → server at :6174). The Ant-Client-Version
 * custom header triggers a preflight OPTIONS request.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  CURRENT_TIER,
  SERVER_VERSION,
  BUILD_CHANNEL,
  getFeaturesForTier,
  getFeatureFlagsForTier,
  getLimitsForTier,
  getMigrationCompatibility,
  getBranding,
} from '$lib/server/featureGates';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { getCookieValuesFromRequest } from '$lib/server/authGate';
import {
  resolveBrowserSessionSecretIgnoringRoom,
  touchBrowserSessionLastSeen
} from '$lib/server/browserSessionStore';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Ant-Client-Version, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function nativeClientConfig(request: Request) {
  const url = new URL(request.url);
  const recommendedBaseUrl = url.origin;
  return {
    recommendedBaseUrl,
    endpoints: {
      capabilities: '/api/capabilities',
      health: '/api/health',
      rooms: '/api/chat-rooms',
      room: '/api/chat-rooms/{roomId}',
      roomMessages: '/api/chat-rooms/{roomId}/messages',
      roomEvents: '/api/realtime/{roomId}/events',
      terminals: '/api/terminals',
      tasks: '/api/tasks',
      plans: '/api/plans',
      asks: '/api/asks',
      diagnosticsSummary: '/api/diagnostics/summary'
    },
    headers: {
      clientVersion: 'Ant-Client-Version',
      contentType: 'Content-Type'
    },
    cors: {
      methods: ['GET', 'HEAD', 'OPTIONS'],
      allowedHeaders: ['Ant-Client-Version', 'Content-Type']
    }
  };
}

function viewerHandleFromBrowserSession(request: Request): string | null {
  for (const secret of getCookieValuesFromRequest(request, 'ant_browser_session')) {
    const resolved = resolveBrowserSessionSecretIgnoringRoom(secret);
    if (resolved) {
      touchBrowserSessionLastSeen(resolved.session_id);
      return resolved.handle;
    }
  }
  return null;
}

export const GET: RequestHandler = async ({ request }) => {
  const viewerHandle = viewerHandleFromBrowserSession(request);
  const response = json({
    serverVersion: SERVER_VERSION,
    buildChannel: BUILD_CHANNEL,
    tier: CURRENT_TIER,
    features: getFeaturesForTier(CURRENT_TIER),
    featureFlags: getFeatureFlagsForTier(CURRENT_TIER),
    limits: getLimitsForTier(CURRENT_TIER),
    migrationCompatibility: getMigrationCompatibility(),
    branding: getBranding(),
    // The configured structural handle of the human operator. The browser
    // composer mints + attributes posts under this handle so the client and
    // server agree end-to-end (no `@you` sentinel leaking into the UI).
    operatorHandle: getOperatorHandle(),
    // The authenticated browser-session handle, when present. This is distinct
    // from the structural operator: agent-owned browser views should post,
    // react, read receipts, and away-mode fetch as the agent, not as @JWPK.
    viewerHandle,
    native: nativeClientConfig(request),
  });

  // Add CORS headers for cross-origin native app webviews
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }

  // Echo back the requesting Origin if present (more precise than wildcard)
  const origin = request.headers.get('origin');
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }

  return response;
};

export const OPTIONS: RequestHandler = async ({ request }) => {
  const response = new Response(null, { status: 204 });

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }

  const origin = request.headers.get('origin');
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }

  return response;
};
