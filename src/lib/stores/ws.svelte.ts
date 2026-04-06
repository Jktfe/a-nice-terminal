let ws = $state<WebSocket | null>(null);
let connected = $state(false);

export function useWsStore() {
  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
      connected = true;
    };

    ws.onclose = () => {
      connected = false;
      // Reconnect after 2s
      setTimeout(connect, 2000);
    };

    ws.onmessage = event => {
      const data = JSON.parse(event.data);
      // Dispatch to appropriate store based on event type
      // This will be wired up by the layout component
    };
  }

  function send(type: string, payload: any) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  return {
    get connected() {
      return connected;
    },
    connect,
    send,
  };
}
