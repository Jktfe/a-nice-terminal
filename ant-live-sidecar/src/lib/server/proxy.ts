import { GoogleGenAI } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';

// We need a way to attach a WebSocket server to SvelteKit's dev server / Node server.
// In dev, we can use a Vite plugin. In prod, we'd attach to the Node server.
// For the sidecar proxy logic, we will export a setup function.

export function setupWebSocketProxy(wss: WebSocketServer, apiKey: string | undefined) {
	wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
		console.log('Client connected to proxy');

		if (!apiKey) {
			console.error('GEMINI_API_KEY not configured');
			clientWs.close(1011, 'GEMINI_API_KEY not configured');
			return;
		}

		const HOST = 'generativelanguage.googleapis.com';
		const MODEL = 'models/gemini-2.0-flash-exp';
		const geminiWsUrl = `wss://${HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

		const geminiWs = new WebSocket(geminiWsUrl);

		geminiWs.on('open', () => {
			console.log('Connected to Gemini Live API');
			
			// Send initial setup message
			const setupMessage = {
				setup: {
					model: MODEL,
					generationConfig: {
						responseModalities: ["AUDIO"],
						speechConfig: {
							voiceConfig: {
								prebuiltVoiceConfig: {
									voiceName: "Aoede" // Choose a nice voice
								}
							}
						}
					}
				}
			};
			geminiWs.send(JSON.stringify(setupMessage));
			
			// Tell the frontend we are ready
			clientWs.send(JSON.stringify({ type: 'proxy_ready' }));
		});

		// --- Route Gemini -> Client ---
		geminiWs.on('message', (data: Buffer | string) => {
			try {
				const response = JSON.parse(data.toString());
				
				if (response.serverContent?.modelTurn?.parts) {
					// We have audio/text parts to send to the client
					const parts = response.serverContent.modelTurn.parts;
					for (const part of parts) {
						if (part.inlineData) {
							// Send binary audio data down to client
							clientWs.send(JSON.stringify({
								type: 'audio',
								data: part.inlineData.data,
								mimeType: part.inlineData.mimeType
							}));
						}
						if (part.text) {
							// Send text transcript
							clientWs.send(JSON.stringify({
								type: 'text',
								text: part.text
							}));
						}
					}
				}
			} catch (e) {
				console.error("Error parsing Gemini message", e);
			}
		});

		// --- Route Client -> Gemini ---
		clientWs.on('message', (data: Buffer | string) => {
			if (geminiWs.readyState !== WebSocket.OPEN) return;

			try {
				// The client will send JSON with base64 audio/video chunks
				const payload = JSON.parse(data.toString());
				
				if (payload.type === 'realtimeInput') {
					// Format it for the Bidi API
					const geminiInput = {
						realtimeInput: {
							mediaChunks: payload.mediaChunks // Array of {mimeType, data}
						}
					};
					geminiWs.send(JSON.stringify(geminiInput));
				}
				
				if (payload.type === 'clientContent') {
					// Text injection (e.g. context from the ANT room)
					const geminiInput = {
						clientContent: {
							turns: [{
								role: "user",
								parts: [{ text: payload.text }]
							}],
							turnComplete: true
						}
					};
					geminiWs.send(JSON.stringify(geminiInput));
				}
			} catch (e) {
				console.error("Error parsing client message", e);
			}
		});

		clientWs.on('close', () => {
			console.log('Client disconnected');
			geminiWs.close();
		});

		geminiWs.on('close', () => {
			console.log('Gemini WS closed');
			clientWs.close();
		});
		
		geminiWs.on('error', (err) => {
			console.error('Gemini WS error:', err);
		});
	});
}