class VoskAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 512;
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) {
            return true;
        }

        const channelData = input[0];

        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.bufferIndex++] = channelData[i];

            if (this.bufferIndex >= this.bufferSize) {
                // Convert Float32 to Int16
                const int16Buffer = new Int16Array(this.bufferSize);
                for (let j = 0; j < this.bufferSize; j++) {
                    const s = Math.max(-1, Math.min(1, this.buffer[j]));
                    int16Buffer[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }

                // Send to main thread
                this.port.postMessage(int16Buffer);

                // Reset buffer
                this.bufferIndex = 0;
            }
        }

        return true;
    }
}

registerProcessor('vosk-audio-processor', VoskAudioProcessor);
