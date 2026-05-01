import { setAgentStatus, clearAgentStatus } from './agent-status.svelte';
import { SESSIONS_CHANNEL } from '$lib/ws-channels';

let ws = $state<WebSocket | null>(null);
let connected = $state(false);
let knownBuildId: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const typingHandles = $state<Record<string, ReturnType<typeof setTimeout>>>({});

export function useWsStore() {
  function connect() {
    if (typeof window === 'undefined') return;
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
      connected = true;
      ws?.send(JSON.stringify({ type: 'join_session', sessionId: SESSIONS_CHANNEL }));
    };

    ws.onclose = () => {
      connected = false;
      // Reconnect after 2s
      reconnectTimer = setTimeout(connect, 2000);
    };

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'build_id') {
          if (knownBuildId === null) {
            knownBuildId = data.buildId;
          } else if (knownBuildId !== data.buildId) {
            console.warn('[ant] Server restarted with new build — reloading');
            setTimeout(() => window.location.reload(), 200);
          }
        }
        if (data.type === 'typing') {
          const handle = data.handle as string;
          if (data.typing) {
            if (typingHandles[handle]) clearTimeout(typingHandles[handle]);
            typingHandles[handle] = setTimeout(() => { delete typingHandles[handle]; }, 3000);
          } else {
            clearTimeout(typingHandles[handle]);
            delete typingHandles[handle];
          }
        }
        if (data.type === 'agent_status_updated' && typeof data.sessionId === 'string' && data.status) {
          setAgentStatus(data.sessionId, data.status);
        }
        if (data.type === 'sessions_changed' && Array.isArray(data.removedIds)) {
          for (const id of data.removedIds) clearAgentStatus(id);
        }
      } catch {}
    };
  }

  function send(type: string, payload: any) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  function getTyping() {
    return Object.keys(typingHandles);
  }

  return {
    get connected() {
      return connected;
    },
    connect,
    send,
    getTyping,
  };
}
