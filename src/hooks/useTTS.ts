import { useState, useRef, useCallback } from 'react';

export function useTTS() {
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const pendingPlayTimeoutRef = useRef<any | null>(null);

    const speak = useCallback(async (text: string) => {
        if (!text || !text.trim()) return;

        try {
            // Fetch audio buffer from main process
            const result = await window.electronAPI.tts.synthesize(text);

            if (!result.success || !result.audio) {
                console.error("TTS failed:", result.error);
                return;
            }

            // Stop any currently playing audio
            if (audioRef.current) {
                audioRef.current.pause();
                URL.revokeObjectURL(audioRef.current.src);
            }

            // Create a blob from the buffer
            const blob = new Blob([result.audio], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);

            const audio = new Audio(url);
            audioRef.current = audio;

            audio.onplay = () => setIsPlaying(true);
            audio.onended = () => {
                setIsPlaying(false);
                URL.revokeObjectURL(url);
            };
            audio.onerror = (e) => {
                console.error("Audio playback error:", e);
                setIsPlaying(false);
                URL.revokeObjectURL(url);
            };

            // Audio-Level Commit Gating: Wait 200ms before actually playing.
            // This gives the LLM speculative execution a "grace window" to cancel
            // the audio if the user resumes speaking, ensuring zero perceived latency
            // without interrupting the user mid-sentence.
            pendingPlayTimeoutRef.current = setTimeout(async () => {
                pendingPlayTimeoutRef.current = null;
                try {
                    if (audioRef.current === audio) {
                        await audio.play();
                    }
                } catch (e) {
                    console.error("Delayed audio playback failed:", e);
                    setIsPlaying(false);
                }
            }, 200);

        } catch (error) {
            console.error("Failed to speak text:", error);
            setIsPlaying(false);
        }
    }, []);

    const stop = useCallback(() => {
        if (pendingPlayTimeoutRef.current) {
            clearTimeout(pendingPlayTimeoutRef.current);
            pendingPlayTimeoutRef.current = null;
            console.log("[TTS] Audio commit cancelled (speculative abort).");
        }

        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            URL.revokeObjectURL(audioRef.current.src);
            audioRef.current = null;
        }
        setIsPlaying(false);
    }, []);

    return { speak, stop, isPlaying };
}
