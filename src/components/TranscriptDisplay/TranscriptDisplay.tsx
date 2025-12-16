import { useEffect, useRef } from 'react';

interface TranscriptDisplayProps {
    transcript: string;
    isLoading: boolean;
    isTranscribing?: boolean;
    error?: string;
}

export function TranscriptDisplay({ transcript, isLoading, isTranscribing, error }: TranscriptDisplayProps) {
    const transcriptEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);

    return (
        <div className="flex-1 overflow-y-auto p-4 bg-black/20 rounded-lg backdrop-blur-md scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-white/5">
            <div className="min-h-full flex flex-col">
                {error && (
                    <div className="mb-4 p-3 bg-destructive/10 border-l-4 border-destructive rounded text-destructive">
                        {error}
                    </div>
                )}
                {transcript && (
                    <p className="text-white text-base leading-relaxed whitespace-pre-wrap break-words py-2">
                        {transcript}
                    </p>
                )}
                {!transcript && !isLoading && !error && (
                    <p className="text-muted-foreground italic opacity-60">
                        Click start to begin transcription...
                    </p>
                )}
                {isLoading && (
                    <p className="text-muted-foreground italic opacity-60">
                        Loading Whisper model (first time may take a moment)...
                    </p>
                )}
                {isTranscribing && (
                    <div className="flex items-center gap-2 text-blue-400 text-sm mt-2">
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                        <span>Transcribing...</span>
                    </div>
                )}
                <div ref={transcriptEndRef} />
            </div>
        </div>
    );
}
