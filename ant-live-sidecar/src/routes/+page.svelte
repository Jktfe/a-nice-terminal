<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let videoElement: HTMLVideoElement;
	let audioElement: HTMLAudioElement;
	let stream: MediaStream | null = $state(null);
	let ws: WebSocket | null = null;
	let status = $state('Disconnected');
	let transcript = $state('');

	// Audio playback queue
	let audioQueue: string[] = [];
	let isPlaying = false;
	
	// Audio capture state
	let audioContext: AudioContext | null = null;
	let mediaStreamSource: MediaStreamAudioSourceNode | null = null;
	let workletNode: AudioWorkletNode | null = null;

	// ArrayBuffer to Base64 helper
	function bufferToBase64(buffer: ArrayBuffer) {
		let binary = '';
		const bytes = new Uint8Array(buffer);
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return window.btoa(binary);
	}

	async function startCamera() {
		try {
			status = 'Requesting permissions...';
			stream = await navigator.mediaDevices.getUserMedia({ 
				video: { facingMode: 'environment' }, // Default to back camera for sketches
				audio: true 
			});
			if (videoElement) {
				videoElement.srcObject = stream;
			}
			connectWebSocket();
		} catch (err) {
			console.error("Camera error:", err);
			status = 'Camera/Mic denied or unavailable';
		}
	}

	function connectWebSocket() {
		status = 'Connecting to proxy...';
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

		ws.onopen = () => {
			status = 'Connected to proxy. Waiting for Gemini...';
		};

		ws.onmessage = async (event) => {
			const data = JSON.parse(event.data);
			
			if (data.type === 'proxy_ready') {
				status = 'Live Session Active';
				startStreaming();
			} else if (data.type === 'text') {
				transcript += `\nGemini: ${data.text}`;
			} else if (data.type === 'audio') {
				audioQueue.push(data.data);
				playNextAudio();
			}
		};

		ws.onclose = () => {
			status = 'Disconnected';
			stopStreaming();
		};
	}

	async function playNextAudio() {
		if (isPlaying || audioQueue.length === 0) return;
		isPlaying = true;
		
		const base64Audio = audioQueue.shift();
		if (!base64Audio || !audioElement) {
			isPlaying = false;
			return;
		}

		const audioSrc = `data:audio/pcm;base64,${base64Audio}`;
		audioElement.src = audioSrc;
		
		try {
			await audioElement.play();
		} catch (e) {
			console.error("Audio play error", e);
			isPlaying = false;
			playNextAudio();
		}
	}

	async function startStreaming() {
		if (!stream || !ws) return;

		// 1. Video Streaming Loop
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		
		setInterval(() => {
			if (ws?.readyState === WebSocket.OPEN && videoElement && ctx) {
				canvas.width = videoElement.videoWidth;
				canvas.height = videoElement.videoHeight;
				ctx.drawImage(videoElement, 0, 0);
				
				const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
				const base64Data = dataUrl.split(',')[1];

				ws.send(JSON.stringify({
					type: 'realtimeInput',
					mediaChunks: [{
						mimeType: 'image/jpeg',
						data: base64Data
					}]
				}));
			}
		}, 1000); // 1 frame per second for prototype

		// 2. Audio Streaming Loop
		try {
			// Gemini requires 16000Hz PCM
			audioContext = new AudioContext({ sampleRate: 16000 });
			await audioContext.audioWorklet.addModule('/pcm-processor.js');
			
			mediaStreamSource = audioContext.createMediaStreamSource(stream);
			workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
			
			workletNode.port.onmessage = (event) => {
				const pcm16Buffer = event.data; // Int16Array
				
				if (ws?.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({
						type: 'realtimeInput',
						mediaChunks: [{
							mimeType: 'audio/pcm;rate=16000',
							data: bufferToBase64(pcm16Buffer.buffer)
						}]
					}));
				}
			};
			
			mediaStreamSource.connect(workletNode);
			workletNode.connect(audioContext.destination);
			
		} catch (e) {
			console.error("Audio capture failed:", e);
		}
	}

	function stopStreaming() {
		if (stream) {
			stream.getTracks().forEach(t => t.stop());
		}
		if (ws) {
			ws.close();
		}
		if (audioContext) {
			audioContext.close();
			audioContext = null;
		}
		if (workletNode) {
			workletNode.disconnect();
			workletNode = null;
		}
		if (mediaStreamSource) {
			mediaStreamSource.disconnect();
			mediaStreamSource = null;
		}
	}

	function handleAudioEnded() {
		isPlaying = false;
		playNextAudio();
	}

	onDestroy(() => {
		stopStreaming();
	});
</script>

<div class="container">
	<header>
		<h1>Multimodal Live Companion</h1>
		<div class="status" class:active={status === 'Live Session Active'}>{status}</div>
	</header>

	<main>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video bind:this={videoElement} autoplay playsinline muted></video>
		<audio bind:this={audioElement} onended={handleAudioEnded}></audio>

		{#if !stream}
			<button onclick={startCamera}>Start Live Session</button>
		{:else}
			<button class="stop" onclick={stopStreaming}>End Call</button>
		{/if}

		<div class="transcript">
			<pre>{transcript}</pre>
		</div>
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
		background: #111;
		color: white;
	}
	.container {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	header {
		padding: 1rem;
		background: #222;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h1 { margin: 0; font-size: 1.2rem; }
	.status {
		font-size: 0.9rem;
		color: #888;
	}
	.status.active {
		color: #4ade80;
	}
	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		gap: 1rem;
	}
	video {
		width: 100%;
		max-height: 50vh;
		background: #000;
		border-radius: 8px;
		object-fit: cover;
	}
	button {
		padding: 1rem;
		font-size: 1.1rem;
		border-radius: 8px;
		border: none;
		background: #3b82f6;
		color: white;
		cursor: pointer;
		font-weight: bold;
	}
	button.stop {
		background: #ef4444;
	}
	.transcript {
		flex: 1;
		background: #222;
		border-radius: 8px;
		padding: 1rem;
		overflow-y: auto;
	}
	pre {
		margin: 0;
		white-space: pre-wrap;
	}
</style>