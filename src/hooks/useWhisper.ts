import { useState, useCallback, useRef } from 'react';

interface UseWhisperReturn {
    isModelLoading: boolean;
    isModelLoaded: boolean;
    modelError: string;
    transcribe: (audioData: Float32Array) => Promise<string>;
    loadModel: () => Promise<void>;
}

export function useWhisper(): UseWhisperReturn {
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [isModelLoaded, setIsModelLoaded] = useState(false);
    const [modelError, setModelError] = useState('');
    const isLoadingRef = useRef(false);

    const loadModel = useCallback(async () => {
        // Prevent multiple simultaneous loads
        if (isLoadingRef.current || isModelLoaded) {
            return;
        }

        isLoadingRef.current = true;
        setIsModelLoading(true);
        setModelError('');

        try {
            if (!window.electronAPI || !window.electronAPI.whisper) {
                throw new Error('Electron API not available. Preload script may not have loaded correctly.');
            }

            const result = await window.electronAPI.whisper.loadModel('base.en');

            if (result.success) {
                setIsModelLoaded(true);
            } else {
                throw new Error(result.error || 'Failed to load model');
            }
        } catch (error) {
            console.error('Failed to load Whisper model:', error);
            setModelError(
                error instanceof Error ? error.message : 'Failed to load speech recognition model'
            );
            setIsModelLoaded(false);
        } finally {
            setIsModelLoading(false);
            isLoadingRef.current = false;
        }
    }, [isModelLoaded]);

    const transcribe = useCallback(
        async (audioData: Float32Array): Promise<string> => {
            if (!isModelLoaded) {
                throw new Error('Model not loaded. Call loadModel() first.');
            }

            try {
                const result = await window.electronAPI.whisper.transcribe(audioData);

                if (result.success) {
                    return result.text;
                } else {
                    throw new Error(result.error || 'Transcription failed');
                }
            } catch (error) {
                console.error('Transcription error:', error);
                throw error;
            }
        },
        [isModelLoaded]
    );

    return {
        isModelLoading,
        isModelLoaded,
        modelError,
        transcribe,
        loadModel,
    };
}
