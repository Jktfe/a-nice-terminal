import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { setupWebSocketProxy } from './src/lib/server/proxy';
import { WebSocketServer } from 'ws';
import type { ViteDevServer } from 'vite';
import * as dotenv from 'dotenv';

// Force load the .env file from the current directory
dotenv.config();

const webSocketPlugin = {
	name: 'websocket-proxy',
	configureServer(server: ViteDevServer) {
		if (server.httpServer) {
			const wss = new WebSocketServer({ noServer: true });
			// Now process.env.GEMINI_API_KEY is guaranteed to be set
			setupWebSocketProxy(wss, process.env.GEMINI_API_KEY);
			server.httpServer.on('upgrade', (req, socket, head) => {
				if (req.url === '/ws') {
					wss.handleUpgrade(req, socket, head, (ws) => {
						wss.emit('connection', ws, req);
					});
				}
			});
		}
	}
};

export default defineConfig({
	plugins: [sveltekit(), webSocketPlugin],
	server: {
		allowedHosts: true
	}
});