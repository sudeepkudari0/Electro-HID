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
            console.log('Loading Whisper model via IPC...');
            console.log('window.electronAPI:', window.electronAPI);
            console.log('window.electronAPI.whisper:', window.electronAPI?.whisper);

            if (!window.electronAPI || !window.electronAPI.whisper) {
                throw new Error('Electron API not available. Preload script may not have loaded correctly.');
            }

            const result = await window.electronAPI.whisper.loadModel('base.en');

            if (result.success) {
                setIsModelLoaded(true);
                console.log('Whisper model loaded successfully');
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
                console.log(`Transcribing ${audioData.length} audio samples via IPC...`);

                const result = await window.electronAPI.whisper.transcribe(audioData);
                console.log('IPC result:', result);
                console.log('result.success:', result.success);
                console.log('result.text:', result.text);

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
