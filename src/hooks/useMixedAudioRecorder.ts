import { useState, useRef, useCallback, useEffect } from 'react';

interface UseMixedAudioRecorderReturn {
    isRecording: boolean;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    audioChunks: Blob[];
    clearChunks: () => void;
}

export function useMixedAudioRecorder(
    onDataAvailable?: (chunks: Blob[]) => void
): UseMixedAudioRecorderReturn {
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mixedStreamRef = useRef<MediaStream | null>(null);
    const onDataAvailableRef = useRef(onDataAvailable);

    // Keep the ref updated with the latest callback
    useEffect(() => {
        onDataAvailableRef.current = onDataAvailable;
    }, [onDataAvailable]);

    const startRecording = useCallback(async () => {
        try {
            // Get microphone stream
            const micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                },
            });

            // Get desktop sources
            const sources = await window.electronAPI.getDesktopSources();

            // Use the first screen source (entire screen audio)
            const screenSource = sources.find(s => s.type === 'screen');
            if (!screenSource) {
                console.warn('No screen source found, using microphone only');
                // Fall back to mic only
                setupRecorder(micStream);
                return;
            }

            // Get system audio stream using Electron's desktopCapturer
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

            // Create audio context for mixing
            const audioContext = new AudioContext({ sampleRate: 16000 });
            audioContextRef.current = audioContext;

            // Create sources
            const micSource = audioContext.createMediaStreamSource(micStream);
            const systemSource = audioContext.createMediaStreamSource(systemStream);

            // Create gain nodes for volume control
            const micGain = audioContext.createGain();
            const systemGain = audioContext.createGain();

            // Set volumes - system audio quieter (30% volume)
            micGain.gain.value = 1.0; // Full microphone volume
            systemGain.gain.value = 0.3; // System audio at 30%

            // Create mixer destination
            const destination = audioContext.createMediaStreamDestination();

            // Connect everything
            micSource.connect(micGain);
            systemSource.connect(systemGain);
            micGain.connect(destination);
            systemGain.connect(destination);

            // Use the mixed stream
            const mixedStream = destination.stream;
            mixedStreamRef.current = mixedStream;

            // Setup recorder with mixed stream
            setupRecorder(mixedStream);

        } catch (error) {
            console.error('Failed to start mixed recording:', error);
            throw error;
        }

        function setupRecorder(stream: MediaStream) {
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus',
            });

            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);

                    // Notify parent component if callback provided - use ref to get latest version
                    if (onDataAvailableRef.current) {
                        onDataAvailableRef.current([...audioChunksRef.current]);
                    }
                }
            };

            // Start recording with timeslice (3 seconds)
            mediaRecorder.start(3000);
            setIsRecording(true);
        }
    }, []); // No dependencies needed since we use refs

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }

        if (mixedStreamRef.current) {
            mixedStreamRef.current.getTracks().forEach((track) => track.stop());
            mixedStreamRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        mediaRecorderRef.current = null;
        setIsRecording(false);
    }, []);

    const clearChunks = useCallback(() => {
        audioChunksRef.current = [];
    }, []);

    return {
        isRecording,
        startRecording,
        stopRecording,
        audioChunks: audioChunksRef.current,
        clearChunks,
    };
}
