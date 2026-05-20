// This is an AudioWorkletProcessor that captures raw audio data and
// converts it to the 16kHz PCM format required by the Gemini Multimodal Live API.

class PCMProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		// We expect the AudioContext to be running at 16000Hz, so we don't
		// need to do complex downsampling here, just buffer the data.
		this.bufferSize = 2048; // Send chunks of 2048 samples
		this.buffer = new Float32Array(this.bufferSize);
		this.bufferIndex = 0;
	}

	process(inputs, outputs, parameters) {
		const input = inputs[0];
		if (input.length > 0) {
			const channelData = input[0];
			
			for (let i = 0; i < channelData.length; i++) {
				this.buffer[this.bufferIndex++] = channelData[i];
				
				if (this.bufferIndex >= this.bufferSize) {
					// Convert Float32 [-1.0, 1.0] to Int16 [-32768, 32767]
					const pcm16Buffer = new Int16Array(this.bufferSize);
					for (let j = 0; j < this.bufferSize; j++) {
						let s = Math.max(-1, Math.min(1, this.buffer[j]));
						pcm16Buffer[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
					}
					
					// We need to send it to the main thread as Base64 for JSON transmission
					// (The postMessage API requires transferring raw buffers if we don't want to copy,
					// but for this prototype, converting to base64 in the worklet or main thread works.
					// Let's send the raw Int16Array and convert in the main thread.)
					this.port.postMessage(pcm16Buffer);
					this.bufferIndex = 0;
				}
			}
		}
		return true;
	}
}

registerProcessor('pcm-processor', PCMProcessor);