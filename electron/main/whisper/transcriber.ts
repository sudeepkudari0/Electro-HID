import path from 'path';
import { app } from 'electron';

// In CommonJS, require is available natively
const whisperPkg = require('@lumen-labs-dev/whisper-node');
const whisper = whisperPkg.whisper || whisperPkg.default;

export class WhisperTranscriber {
    private modelPath: string | null = null;
    private isInitialized = false;
    private modelName: string = 'tiny.en';

    constructor() {
        // Models will be stored in userData directory
        const modelsDir = path.join(app.getPath('userData'), 'models');
        console.log('Models directory:', modelsDir);
    }

    async initialize(modelName: string = 'tiny.en'): Promise<void> {
        if (this.isInitialized) {
            console.log('Whisper already initialized');
            return;
        }

        try {
            console.log(`Initializing Whisper with model: ${modelName}`);

            // Store model name for later use
            this.modelName = modelName;
            const modelPath = await this.ensureModel(modelName);
            this.modelPath = modelPath;

            this.isInitialized = true;
            console.log('Whisper initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Whisper:', error);
            throw error;
        }
    }

    private async ensureModel(modelName: string): Promise<string> {
        const modelsDir = path.join(app.getPath('userData'), 'models');
        const modelPath = path.join(modelsDir, `ggml-${modelName}.bin`);

        // whisper-node will automatically download the model if it doesn't exist
        return modelPath;
    }

    async transcribe(audioData: Float32Array): Promise<string> {
        if (!this.isInitialized) {
            throw new Error('Whisper not initialized. Call initialize() first.');
        }

        try {
            // Convert Float32Array to WAV buffer
            const wavBuffer = this.float32ToWav(audioData, 16000);

            // Save temporarily
            const tempPath = path.join(app.getPath('temp'), `whisper-${Date.now()}.wav`);
            const fs = await import('fs/promises');
            await fs.writeFile(tempPath, wavBuffer);

            // Transcribe using @lumen-labs-dev/whisper-node
            const result = await whisper(tempPath, {
                modelName: this.modelName,
            });

            console.log('Whisper raw result:', result);
            console.log('Result type:', typeof result);
            console.log('Result is array:', Array.isArray(result));
            console.log('Result length:', result?.length);
            console.log('Result JSON:', JSON.stringify(result, null, 2));

            // Clean up temp file
            await fs.unlink(tempPath).catch(() => { });

            // The result is an array of segments with 'text' property
            if (result && Array.isArray(result) && result.length > 0) {
                console.log('Processing array result...');
                // Concatenate all segment texts - whisper-node uses 'speech' property
                const text = result.map((segment: any) => segment.speech || '').join(' ');
                console.log('Extracted text:', text);
                return text;
            }

            console.log('Result was empty or not an array, returning empty string');
            return '';
        } catch (error) {
            console.error('Transcription error:', error);
            throw error;
        }
    }

    private float32ToWav(samples: Float32Array, sampleRate: number): Buffer {
        const buffer = Buffer.alloc(44 + samples.length * 2);

        // WAV header
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + samples.length * 2, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // PCM
        buffer.writeUInt16LE(1, 20); // Audio format (PCM)
        buffer.writeUInt16LE(1, 22); // Number of channels
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * 2, 28); // Byte rate
        buffer.writeUInt16LE(2, 32); // Block align
        buffer.writeUInt16LE(16, 34); // Bits per sample
        buffer.write('data', 36);
        buffer.writeUInt32LE(samples.length * 2, 40);

        // Convert float samples to 16-bit PCM
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            const val = s < 0 ? s * 0x8000 : s * 0x7fff;
            buffer.writeInt16LE(val, 44 + i * 2);
        }

        return buffer;
    }

    getStatus() {
        return {
            isLoaded: this.isInitialized,
            modelPath: this.modelPath,
        };
    }

    async dispose(): Promise<void> {
        this.isInitialized = false;
        this.modelPath = null;
        this.modelName = 'tiny.en';
    }
}

// Singleton instance
let transcriber: WhisperTranscriber | null = null;

export function getTranscriber(): WhisperTranscriber {
    if (!transcriber) {
        transcriber = new WhisperTranscriber();
    }
    return transcriber;
}
