import { useRef, useCallback, useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { MicVAD } from '@ricky0123/vad-web';
import ortWasmThreadedMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasmThreadedWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { hasSignificantEnergy } from '../lib/hallucination-filter';

export type SpeakerSource = 'user' | 'interviewer';

interface UseMixedAudioRecorderReturn {
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    clearChunks: () => void;
    audioLevels: { mic: number; system: number };
    isDeepgramStreaming: boolean;
}

/**
 * ChunkRecorder — simple raw PCM audio recorder that slices audio into 
 * fixed 2.5s chunks without using VAD for boundaries.
 */
class ChunkRecorder {
    private audioContext: AudioContext | null = null;
    private processor: ScriptProcessorNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private buffer: number[] = [];
    private intervalId: any = null;

    constructor(
        private stream: MediaStream,
        private source: SpeakerSource,
        private onNewChunk: (source: SpeakerSource, chunk: Float32Array) => void,
        private setLevel: (level: number) => void
    ) {}

    start() {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioContextClass({ sampleRate: 16000 });
            this.sourceNode = this.audioContext!.createMediaStreamSource(this.stream);
            
            // 4096 sample buffer size
            this.processor = this.audioContext!.createScriptProcessor(4096, 1, 1);
            
            this.sourceNode.connect(this.processor);
            this.processor.connect(this.audioContext!.destination);

            this.processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Calculate real-time level (RMS) for waveform visualizer
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) {
                    sum += inputData[i] * inputData[i];
                    this.buffer.push(inputData[i]);
                }
                const rms = Math.sqrt(sum / inputData.length);
                // Amplify level slightly for better visual responsiveness
                this.setLevel(rms);
            };

            // Every 2500ms, flush the buffer
            this.intervalId = setInterval(() => {
                if (this.buffer.length > 0) {
                    const chunk = new Float32Array(this.buffer);
                    this.buffer = [];
                    
                    // Energy check to avoid transcription of empty silent chunks
                    if (hasSignificantEnergy(chunk)) {
                        this.onNewChunk(this.source, chunk);
                    }
                }
            }, 2500);
            
            logger.info(`ChunkRecorder [${this.source}] started successfully.`);
        } catch (error) {
            logger.error(`Failed to start ChunkRecorder [${this.source}]:`, error);
        }
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.processor) {
            try {
                this.processor.disconnect();
            } catch {}
            this.processor.onaudioprocess = null;
            this.processor = null;
        }
        if (this.sourceNode) {
            try {
                this.sourceNode.disconnect();
            } catch {}
            this.sourceNode = null;
        }
        if (this.audioContext) {
            try {
                this.audioContext.close();
            } catch {}
            this.audioContext = null;
        }
        this.buffer = [];
        logger.info(`ChunkRecorder [${this.source}] stopped and resources released.`);
    }
}

/**
 * DeepgramStreamForwarder — captures raw PCM audio and sends it to the
 * main process via IPC for Deepgram WebSocket streaming. Sends every ~250ms
 * for near-real-time transcription.
 */
class DeepgramStreamForwarder {
    private audioContext: AudioContext | null = null;
    private processor: ScriptProcessorNode | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private buffer: number[] = [];
    private intervalId: any = null;

    constructor(
        private stream: MediaStream,
        private source: SpeakerSource,
        private setLevel: (level: number) => void
    ) {}

    start() {
        try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            this.audioContext = new AudioContextClass({ sampleRate: 16000 });
            this.sourceNode = this.audioContext!.createMediaStreamSource(this.stream);
            
            this.processor = this.audioContext!.createScriptProcessor(4096, 1, 1);
            
            this.sourceNode.connect(this.processor);
            this.processor.connect(this.audioContext!.destination);

            this.processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) {
                    sum += inputData[i] * inputData[i];
                    this.buffer.push(inputData[i]);
                }
                const rms = Math.sqrt(sum / inputData.length);
                this.setLevel(rms);
            };

            // Flush buffer every 250ms to Deepgram via IPC
            this.intervalId = setInterval(() => {
                if (this.buffer.length > 0) {
                    const chunk = this.buffer;
                    this.buffer = [];
                    
                    // Send raw PCM to main process (no energy check — Deepgram handles VAD)
                    window.electronAPI?.deepgram?.sendAudio(this.source, chunk);
                }
            }, 250);
            
            logger.info(`DeepgramStreamForwarder [${this.source}] started (250ms intervals).`);
        } catch (error) {
            logger.error(`Failed to start DeepgramStreamForwarder [${this.source}]:`, error);
        }
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.processor) {
            try { this.processor.disconnect(); } catch {}
            this.processor.onaudioprocess = null;
            this.processor = null;
        }
        if (this.sourceNode) {
            try { this.sourceNode.disconnect(); } catch {}
            this.sourceNode = null;
        }
        if (this.audioContext) {
            try { this.audioContext.close(); } catch {}
            this.audioContext = null;
        }
        this.buffer = [];
        logger.info(`DeepgramStreamForwarder [${this.source}] stopped.`);
    }
}

/**
 * Mixed audio recorder with Silero VAD (Utterance-based), continuous Chunks, or Deepgram Streaming mode.
 *
 * @param onNewChunk - Called when a complete utterance/chunk is ready for transcription
 * @param onInterviewerUtteranceEnd - Called when the interviewer finishes speaking (VAD only)
 * @param onInterviewerSpeechStart - Called when interviewer starts speaking (VAD only)
 */
export function useMixedAudioRecorder(
    onNewChunk?: (source: SpeakerSource, chunk: Float32Array) => void,
    onInterviewerUtteranceEnd?: () => void,
    onInterviewerSpeechStart?: () => void
): UseMixedAudioRecorderReturn {
    const [audioLevels, setAudioLevels] = useState({ mic: 0, system: 0 });
    const [isDeepgramStreaming, setIsDeepgramStreaming] = useState(false);
    const audioLevelDecayRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const systemStreamRef = useRef<MediaStream | null>(null);
    
    // VAD Mode refs
    const micVADRef = useRef<any>(null);
    const systemVADRef = useRef<any>(null);

    // Chunks Mode refs
    const micRecorderRef = useRef<ChunkRecorder | null>(null);
    const systemRecorderRef = useRef<ChunkRecorder | null>(null);

    // Deepgram Stream Mode refs
    const micForwarderRef = useRef<DeepgramStreamForwarder | null>(null);
    const systemForwarderRef = useRef<DeepgramStreamForwarder | null>(null);

    const onNewChunkRef = useRef(onNewChunk);
    const onInterviewerUtteranceEndRef = useRef(onInterviewerUtteranceEnd);
    const onInterviewerSpeechStartRef = useRef(onInterviewerSpeechStart);
    
    useEffect(() => {
        onNewChunkRef.current = onNewChunk;
    }, [onNewChunk]);

    useEffect(() => {
        onInterviewerUtteranceEndRef.current = onInterviewerUtteranceEnd;
    }, [onInterviewerUtteranceEnd]);

    useEffect(() => {
        onInterviewerSpeechStartRef.current = onInterviewerSpeechStart;
    }, [onInterviewerSpeechStart]);

    const startRecording = useCallback(async () => {
        try {
            const settingsRes = await window.electronAPI.getSettings();
            const sttEngine = settingsRes.success && settingsRes.settings ? settingsRes.settings.sttEngine : 'moonshine';
            const mode = settingsRes.success && settingsRes.settings ? settingsRes.settings.sttMode : 'vad';
            const micDeviceId = settingsRes.success && settingsRes.settings ? settingsRes.settings.micDeviceId : undefined;
            const useDeepgramStreaming = sttEngine === 'deepgram';
            
            logger.info(`Starting audio recording (Engine: ${sttEngine}, Mode: ${useDeepgramStreaming ? 'deepgram-stream' : mode}, Mic: ${micDeviceId || 'default'})...`);
            const assetBasePath = import.meta.env.BASE_URL || '/';
            
            const audioConstraints: MediaTrackConstraints = {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000,
            };
            if (micDeviceId && micDeviceId !== 'default') {
                audioConstraints.deviceId = { exact: micDeviceId };
            }

            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints,
            });
            micStreamRef.current = micStream;

            // Capture system audio
            let hasSystemAudio = false;
            try {
                const sources = await window.electronAPI.getDesktopSources();
                const screenSource = sources.find((s: any) => s.type === 'screen');

                if (screenSource) {
                    logger.info(`Found screen source: ${screenSource.id}. Attempting to capture system audio...`);
                    const systemStream = await (navigator.mediaDevices as any).getUserMedia({
                        audio: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: screenSource.id,
                            },
                        },
                        video: {
                            mandatory: {
                                chromeMediaSource: 'desktop',
                                chromeMediaSourceId: screenSource.id,
                                minWidth: 1280,
                                maxWidth: 1280,
                                minHeight: 720,
                                maxHeight: 720,
                            },
                        },
                    });
                    
                    const sysAudioStream = new MediaStream(systemStream.getAudioTracks());
                    systemStreamRef.current = sysAudioStream;
                    hasSystemAudio = sysAudioStream.getAudioTracks().length > 0;
                    
                    systemStream.getVideoTracks().forEach((track: any) => track.stop());
                    logger.info('System audio capture successful.');
                }
            } catch (err) {
                logger.warn('System audio unavailable:', err);
            }

            if (useDeepgramStreaming) {
                // ═══ Deepgram Streaming Mode ═══
                logger.info('Initializing Deepgram WebSocket streaming...');
                setIsDeepgramStreaming(true);

                // Start the Deepgram WebSocket session (mic channel)
                const startResult = await window.electronAPI.deepgram.startStream();
                if (!startResult.success) {
                    throw new Error(`Failed to start Deepgram stream: ${startResult.error}`);
                }

                // Start mic forwarder
                if (micStreamRef.current) {
                    micForwarderRef.current = new DeepgramStreamForwarder(
                        micStreamRef.current,
                        'user',
                        (level) => setAudioLevels(prev => ({ ...prev, mic: Math.min(level * 5, 1) }))
                    );
                    micForwarderRef.current.start();
                }

                // Start system audio forwarder + system WebSocket session
                if (hasSystemAudio && systemStreamRef.current) {
                    try {
                        await window.electronAPI.deepgram.startSystemSession();
                        systemForwarderRef.current = new DeepgramStreamForwarder(
                            systemStreamRef.current,
                            'interviewer',
                            (level) => setAudioLevels(prev => ({ ...prev, system: Math.min(level * 5, 1) }))
                        );
                        systemForwarderRef.current.start();
                    } catch (err) {
                        logger.warn('Failed to start Deepgram system session:', err);
                    }
                }

            } else if (mode === 'chunks') {
                // Initialize Chunks Mode
                logger.info('Initializing Continuous Chunk Recorders...');
                
                if (micStreamRef.current) {
                    micRecorderRef.current = new ChunkRecorder(
                        micStreamRef.current,
                        'user',
                        (src, chunk) => onNewChunkRef.current?.(src, chunk),
                        (level) => setAudioLevels(prev => ({ ...prev, mic: Math.min(level * 5, 1) }))
                    );
                    micRecorderRef.current.start();
                }
                
                if (hasSystemAudio && systemStreamRef.current) {
                    systemRecorderRef.current = new ChunkRecorder(
                        systemStreamRef.current,
                        'interviewer',
                        (src, chunk) => onNewChunkRef.current?.(src, chunk),
                        (level) => setAudioLevels(prev => ({ ...prev, system: Math.min(level * 5, 1) }))
                    );
                    systemRecorderRef.current.start();
                }
            } else {
                // Initialize VAD Mode
                const createVAD = async (stream: MediaStream, source: SpeakerSource) => {
                    return await MicVAD.new({
                        baseAssetPath: assetBasePath,
                        onnxWASMBasePath: assetBasePath,
                        getStream: async () => stream,
                        resumeStream: async () => stream,
                        pauseStream: async () => {},
                        ortConfig: (ort) => {
                            ort.env.logLevel = 'error';
                            ort.env.wasm.wasmPaths = {
                                mjs: ortWasmThreadedMjsUrl,
                                wasm: ortWasmThreadedWasmUrl,
                            };
                        },
                        model: "v5",
                        positiveSpeechThreshold: 0.5,
                        negativeSpeechThreshold: 0.35,
                        minSpeechMs: 300,
                        preSpeechPadMs: 500,
                        redemptionMs: 600,
                        submitUserSpeechOnPause: true,
                        onFrameProcessed: (_probabilities, frame) => {
                            let sum = 0;
                            for (let i = 0; i < frame.length; i++) {
                                sum += frame[i] * frame[i];
                            }
                            const rms = Math.sqrt(sum / frame.length);
                            setAudioLevels(prev => ({
                                ...prev,
                                [source === 'user' ? 'mic' : 'system']: Math.min(rms * 5, 1),
                            }));
                        },
                        onSpeechStart: () => {
                            logger.debug(`VAD [${source}]: Speech started detected`);
                            if (source === 'interviewer') {
                                onInterviewerSpeechStartRef.current?.();
                            }
                        },
                        onSpeechEnd: (audio: Float32Array) => {
                            logger.debug(`VAD [${source}]: Speech ended. Length: ${(audio.length / 16000).toFixed(1)}s`);
                            
                            if (hasSignificantEnergy(audio)) {
                                onNewChunkRef.current?.(source, audio);
                            } else {
                                logger.debug(`VAD [${source}]: Discarding utterance due to low energy`);
                            }

                            if (source === 'interviewer') {
                                onInterviewerUtteranceEndRef.current?.();
                            }
                        },
                        onVADMisfire: () => {
                            logger.debug(`VAD [${source}]: Misfire (speech too short)`);
                        }
                    });
                };

                logger.info('Initializing Silero VADs...');
                
                if (micStreamRef.current) {
                    micVADRef.current = await createVAD(micStreamRef.current, 'user');
                    micVADRef.current.start();
                }
                
                if (hasSystemAudio && systemStreamRef.current) {
                    systemVADRef.current = await createVAD(systemStreamRef.current, 'interviewer');
                    systemVADRef.current.start();
                }
            }

            // Decay audio levels over time to create smooth falloff
            audioLevelDecayRef.current = setInterval(() => {
                setAudioLevels(prev => ({
                    mic: prev.mic > 0.01 ? prev.mic * 0.85 : 0,
                    system: prev.system > 0.01 ? prev.system * 0.85 : 0,
                }));
            }, 100);

        } catch (error) {
            logger.error('Failed to start recording:', error);
            throw error;
        }
    }, []);

    const stopRecording = useCallback(() => {
        // Stop Deepgram Stream Mode Forwarders
        if (micForwarderRef.current) {
            micForwarderRef.current.stop();
            micForwarderRef.current = null;
        }
        if (systemForwarderRef.current) {
            systemForwarderRef.current.stop();
            systemForwarderRef.current = null;
        }
        // Stop the Deepgram WebSocket sessions
        if (isDeepgramStreaming) {
            window.electronAPI?.deepgram?.stopStream().catch((err: any) => {
                logger.error('Failed to stop Deepgram stream:', err);
            });
            setIsDeepgramStreaming(false);
        }

        // Stop Chunks Mode Recorders
        if (micRecorderRef.current) {
            micRecorderRef.current.stop();
            micRecorderRef.current = null;
        }
        if (systemRecorderRef.current) {
            systemRecorderRef.current.stop();
            systemRecorderRef.current = null;
        }

        // Stop VAD Mode VADs
        if (micVADRef.current) {
            micVADRef.current.pause();
            micVADRef.current.destroy();
            micVADRef.current = null;
        }
        if (systemVADRef.current) {
            systemVADRef.current.pause();
            systemVADRef.current.destroy();
            systemVADRef.current = null;
        }
        
        if (micStreamRef.current) {
            micStreamRef.current.getTracks().forEach((track) => track.stop());
            micStreamRef.current = null;
        }
        if (systemStreamRef.current) {
            systemStreamRef.current.getTracks().forEach((track) => track.stop());
            systemStreamRef.current = null;
        }

        if (audioLevelDecayRef.current) {
            clearInterval(audioLevelDecayRef.current);
            audioLevelDecayRef.current = null;
        }
        setAudioLevels({ mic: 0, system: 0 });

    }, [isDeepgramStreaming]);

    const clearChunks = useCallback(() => {}, []);

    return {
        startRecording,
        stopRecording,
        clearChunks,
        audioLevels,
        isDeepgramStreaming,
    };
}
