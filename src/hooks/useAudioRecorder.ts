import { useState, useRef, useCallback, useEffect } from 'react';

interface UseAudioRecorderReturn {
    isRecording: boolean;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    audioChunks: Blob[];
    clearChunks: () => void;
}

export function useAudioRecorder(
    onDataAvailable?: (chunks: Blob[]) => void
): UseAudioRecorderReturn {
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const onDataAvailableRef = useRef(onDataAvailable);

    // Keep the ref updated with the latest callback
    useEffect(() => {
        onDataAvailableRef.current = onDataAvailable;
    }, [onDataAvailable]);

    const startRecording = useCallback(async () => {
        try {
            console.log('Requesting microphone access...');

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                },
            });

            streamRef.current = stream;

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus',
            });

            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                    console.log('Audio chunk received:', event.data.size, 'bytes');

                    // Notify parent component if callback provided - use ref to get latest version
                    console.log('onDataAvailable callback exists:', !!onDataAvailableRef.current);
                    if (onDataAvailableRef.current) {
                        console.log('Calling onDataAvailable with', audioChunksRef.current.length, 'chunks');
                        onDataAvailableRef.current([...audioChunksRef.current]);
                    }
                }
            };

            // Start recording with timeslice (3 seconds)
            mediaRecorder.start(3000);
            setIsRecording(true);

            console.log('Recording started');
        } catch (error) {
            console.error('Failed to start recording:', error);
            throw error;
        }
    }, []); // No dependencies needed since we use refs

    const stopRecording = useCallback(() => {
        console.log('Stopping recording...');

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }

        mediaRecorderRef.current = null;
        setIsRecording(false);

        console.log('Recording stopped');
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
