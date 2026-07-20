import WebSocket from 'ws';
import { getSettings } from '../settings';

const isDebugEnabled = process.env.VITE_ENABLE_DEBUG_LOGS === 'true';
function debugLog(...args: any[]) {
    if (isDebugEnabled) {
        console.log('[Deepgram Stream]', ...args);
    }
}

function streamLog(...args: any[]) {
    console.log('[Deepgram Stream]', ...args);
}

export interface DeepgramTranscriptEvent {
    text: string;
    isFinal: boolean;
    words?: { word: string; start: number; end: number; confidence: number }[];
    speaker: 'user' | 'interviewer';
}

export interface DeepgramStreamCallbacks {
    onTranscript: (event: DeepgramTranscriptEvent) => void;
    onUtteranceEnd: (speaker: 'user' | 'interviewer') => void;
    onSpeechStarted: (speaker: 'user' | 'interviewer') => void;
    onError: (error: string) => void;
}

/**
 * A single Deepgram WebSocket streaming session for one audio channel.
 */
class DeepgramChannelSession {
    private ws: WebSocket | null = null;
    private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    private isConnected = false;
    private speaker: 'user' | 'interviewer';
    private callbacks: DeepgramStreamCallbacks;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 3;
    private isStopping = false;

    constructor(speaker: 'user' | 'interviewer', callbacks: DeepgramStreamCallbacks) {
        this.speaker = speaker;
        this.callbacks = callbacks;
    }

    async start(): Promise<void> {
        const settings = getSettings();
        const apiKey = settings.deepgramApiKey;
        const model = settings.deepgramModel || 'nova-3';

        if (!apiKey) {
            throw new Error('Deepgram API Key is missing. Please set it in Settings.');
        }

        this.isStopping = false;
        this.reconnectAttempts = 0;

        const params = new URLSearchParams({
            model,
            language: 'en',
            smart_format: 'true',
            interim_results: 'true',
            endpointing: '300',
            vad_events: 'true',
            utterance_end_ms: '1500',
            encoding: 'linear16',
            sample_rate: '16000',
            channels: '1',
        });

        const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

        return new Promise<void>((resolve, reject) => {
            try {
                this.ws = new WebSocket(url, {
                    headers: {
                        Authorization: `Token ${apiKey}`,
                    },
                });

                this.ws.on('open', () => {
                    streamLog(`[${this.speaker}] WebSocket connected`);
                    this.isConnected = true;
                    this.reconnectAttempts = 0;

                    // Send keepalive every 10s to prevent timeout
                    this.keepAliveInterval = setInterval(() => {
                        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                            this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
                        }
                    }, 10000);

                    resolve();
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        this.handleMessage(msg);
                    } catch (err) {
                        debugLog(`[${this.speaker}] Failed to parse message:`, err);
                    }
                });

                this.ws.on('close', (code, reason) => {
                    streamLog(`[${this.speaker}] WebSocket closed (code=${code}, reason=${reason})`);
                    this.isConnected = false;
                    this.clearKeepAlive();

                    // Auto-reconnect on unexpected close
                    if (!this.isStopping && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.reconnectAttempts++;
                        streamLog(`[${this.speaker}] Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
                        setTimeout(() => {
                            this.start().catch(err => {
                                this.callbacks.onError(`[${this.speaker}] Reconnect failed: ${err.message}`);
                            });
                        }, 1000 * this.reconnectAttempts);
                    }
                });

                this.ws.on('error', (err) => {
                    streamLog(`[${this.speaker}] WebSocket error:`, err.message);
                    if (!this.isConnected) {
                        reject(new Error(`Deepgram WebSocket connection failed: ${err.message}`));
                    } else {
                        this.callbacks.onError(`[${this.speaker}] WebSocket error: ${err.message}`);
                    }
                });
            } catch (err: any) {
                reject(new Error(`Failed to create WebSocket: ${err.message}`));
            }
        });
    }

    private handleMessage(msg: any) {
        const type = msg.type;

        if (type === 'Results') {
            const channel = msg.channel;
            if (!channel || !channel.alternatives || channel.alternatives.length === 0) return;

            const alt = channel.alternatives[0];
            const text = (alt.transcript || '').trim();
            if (!text) return;

            const isFinal = msg.is_final === true;
            const words = alt.words?.map((w: any) => ({
                word: w.word,
                start: w.start,
                end: w.end,
                confidence: w.confidence,
            })) || [];

            debugLog(`[${this.speaker}] ${isFinal ? 'FINAL' : 'interim'}: "${text}"`);

            this.callbacks.onTranscript({
                text,
                isFinal,
                words: words.length > 0 ? words : undefined,
                speaker: this.speaker,
            });
        } else if (type === 'UtteranceEnd') {
            debugLog(`[${this.speaker}] Utterance end`);
            this.callbacks.onUtteranceEnd(this.speaker);
        } else if (type === 'Metadata') {
            debugLog(`[${this.speaker}] Metadata:`, msg);
        } else if (type === 'Error') {
            streamLog(`[${this.speaker}] Deepgram error:`, msg);
            this.callbacks.onError(`Deepgram error: ${msg.message || JSON.stringify(msg)}`);
        }
    }

    /**
     * Send raw PCM Float32 audio to the WebSocket.
     * Converts Float32 [-1,1] to Int16 little-endian bytes for Deepgram.
     */
    sendAudio(pcmFloat32: Float32Array) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        // Convert Float32 to Int16 LE bytes
        const int16Buffer = new ArrayBuffer(pcmFloat32.length * 2);
        const int16View = new DataView(int16Buffer);
        for (let i = 0; i < pcmFloat32.length; i++) {
            const s = Math.max(-1, Math.min(1, pcmFloat32[i]));
            int16View.setInt16(i * 2, Math.round(s * 32767), true); // true = little-endian
        }

        this.ws.send(Buffer.from(int16Buffer));
    }

    async stop(): Promise<void> {
        this.isStopping = true;
        this.clearKeepAlive();

        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                // Send CloseStream message for graceful shutdown
                try {
                    this.ws.send(JSON.stringify({ type: 'CloseStream' }));
                } catch { /* ignore */ }

                // Wait briefly for any final results
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            try {
                this.ws.close();
            } catch { /* ignore */ }
            this.ws = null;
        }

        this.isConnected = false;
        streamLog(`[${this.speaker}] Session stopped`);
    }

    get connected(): boolean {
        return this.isConnected;
    }

    private clearKeepAlive() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    }
}

/**
 * Manages two Deepgram WebSocket sessions — one for mic (user) and one for system audio (interviewer).
 * Provides a simple API to start/stop streaming and send audio from each channel.
 */
export class DeepgramStreamingManager {
    private micSession: DeepgramChannelSession | null = null;
    private systemSession: DeepgramChannelSession | null = null;
    private callbacks: DeepgramStreamCallbacks | null = null;
    private isActive = false;

    /**
     * Start streaming sessions for both channels.
     */
    async start(callbacks: DeepgramStreamCallbacks): Promise<void> {
        if (this.isActive) {
            streamLog('Already active — stopping existing sessions first');
            await this.stop();
        }

        this.callbacks = callbacks;
        this.isActive = true;

        this.micSession = new DeepgramChannelSession('user', callbacks);
        this.systemSession = new DeepgramChannelSession('interviewer', callbacks);

        // Start mic session (always required)
        try {
            await this.micSession.start();
        } catch (err: any) {
            streamLog('Failed to start mic session:', err.message);
            throw err;
        }

        // System session is started separately when system audio is available
        streamLog('Mic session started. System session will start when audio is available.');
    }

    /**
     * Start the system audio (interviewer) session separately.
     * Called when system audio capture succeeds.
     */
    async startSystemSession(): Promise<void> {
        if (!this.callbacks || !this.systemSession) {
            throw new Error('Manager not started. Call start() first.');
        }

        try {
            await this.systemSession.start();
            streamLog('System audio session started.');
        } catch (err: any) {
            streamLog('Failed to start system session:', err.message);
            throw err;
        }
    }

    /**
     * Send audio chunk from a specific channel.
     */
    sendAudio(speaker: 'user' | 'interviewer', pcmFloat32: Float32Array) {
        if (!this.isActive) return;

        const session = speaker === 'user' ? this.micSession : this.systemSession;
        if (session?.connected) {
            session.sendAudio(pcmFloat32);
        }
    }

    /**
     * Stop both sessions gracefully.
     */
    async stop(): Promise<void> {
        this.isActive = false;

        const stopPromises: Promise<void>[] = [];
        if (this.micSession) {
            stopPromises.push(this.micSession.stop());
        }
        if (this.systemSession) {
            stopPromises.push(this.systemSession.stop());
        }

        await Promise.allSettled(stopPromises);

        this.micSession = null;
        this.systemSession = null;
        this.callbacks = null;

        streamLog('All sessions stopped');
    }

    get active(): boolean {
        return this.isActive;
    }
}

// Singleton
let streamingManager: DeepgramStreamingManager | null = null;

export function getDeepgramStreamingManager(): DeepgramStreamingManager {
    if (!streamingManager) {
        streamingManager = new DeepgramStreamingManager();
    }
    return streamingManager;
}
