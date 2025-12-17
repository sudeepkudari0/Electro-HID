import path from 'path';
import { app } from 'electron';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

export class WhisperTranscriber {
    private modelPath: string | null = null;
    private whisperExe: string | null = null;
    private isInitialized = false;
    private modelName: string = 'base.en';

    constructor() {
        // Initialize paths
        this.initializePaths();
    }

    private initializePaths() {
        // Get the resources path - different for dev vs packaged
        const resources = app.isPackaged
            ? process.resourcesPath
            : path.join(process.cwd(), 'native');

        this.whisperExe = path.join(resources, 'whisper', 'whisper.exe');
    }

    async initialize(modelName: string = 'base.en'): Promise<void> {
        if (this.isInitialized) {
            console.log('Whisper already initialized');
            return;
        }

        try {
            this.modelName = modelName;
            const modelPath = await this.ensureModel(modelName);
            this.modelPath = modelPath;

            // Verify whisper.exe exists
            if (!this.whisperExe) {
                throw new Error('Whisper executable path not initialized');
            }

            try {
                await fs.access(this.whisperExe);
            } catch {
                throw new Error(`Whisper executable not found at: ${this.whisperExe}\n\nPlease build/download whisper.cpp and place whisper.exe in native/whisper/`);
            }

            // Verify model exists
            try {
                await fs.access(modelPath);
            } catch {
                console.warn(`Model file not found at: ${modelPath}\nWill need to download model`);
            }

            this.isInitialized = true;
        } catch (error) {
            console.error('Failed to initialize Whisper:', error);
            throw error;
        }
    }

    private async ensureModel(modelName: string): Promise<string> {
        const resources = app.isPackaged
            ? process.resourcesPath
            : path.join(process.cwd(), 'native');

        const modelsDir = path.join(resources, 'whisper', 'models');
        const modelPath = path.join(modelsDir, `ggml-${modelName}.bin`);

        return modelPath;
    }

    async transcribe(audioData: Float32Array): Promise<string> {
        if (!this.isInitialized || !this.whisperExe || !this.modelPath) {
            throw new Error('Whisper not initialized. Call initialize() first.');
        }

        try {
            // Convert Float32Array to WAV buffer
            const wavBuffer = this.float32ToWav(audioData, 16000);

            // Save temporarily
            const tempPath = path.join(app.getPath('temp'), `whisper-${Date.now()}.wav`);
            await fs.writeFile(tempPath, wavBuffer);

            // Transcribe using native whisper.cpp binary
            const result = await this.runWhisperProcess(tempPath);

            // Clean up temp file
            await fs.unlink(tempPath).catch(() => { });

            return result;
        } catch (error) {
            console.error('Transcription error:', error);
            throw error;
        }
    }

    private runWhisperProcess(audioPath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.whisperExe || !this.modelPath) {
                reject(new Error('Whisper not properly initialized'));
                return;
            }

            const args = [
                '-m', this.modelPath,
                '-f', audioPath,
                // '-ng' disables GPU
                '-nt',              // No timestamps in output
                '-l', 'en',         // Language: English
            ];

            // Args: model, audio file, no timestamps, language

            const proc = spawn(this.whisperExe, args, {
                windowsHide: true,
            });

            let stdout = '';
            let stderr = '';
            let gpuDetected = false;

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                // Detect GPU usage
                if (text.includes('CUDA') || text.includes('GPU') || text.includes('cuda')) {
                    gpuDetected = true;
                }
            });

            proc.on('close', (code) => {
                if (code !== 0) {
                    console.error(`❌ Whisper failed (exit code ${code})`);
                    reject(new Error(`Whisper exited with code ${code}\n${stderr}`));
                } else {
                    // Extract transcription
                    const lines = stdout.split('\n');
                    const transcriptionLines = lines.filter(line =>
                        !line.includes('[') &&
                        line.trim().length > 0
                    );
                    const transcription = transcriptionLines.join(' ').trim();

                    resolve(transcription);
                }
            });

            proc.on('error', (error) => {
                reject(new Error(`Failed to start whisper process: ${error.message}`));
            });
        });
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
            whisperExe: this.whisperExe,
        };
    }

    async dispose(): Promise<void> {
        this.isInitialized = false;
        this.modelPath = null;
        this.modelName = 'base.en';
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
