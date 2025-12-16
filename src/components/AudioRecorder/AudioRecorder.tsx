import { Button } from '@/components/ui/Button';
import { Mic, Square } from 'lucide-react';

interface AudioRecorderProps {
    isRecording: boolean;
    isModelLoading: boolean;
    onStart: () => void;
    onStop: () => void;
}

export function AudioRecorder({
    isRecording,
    isModelLoading,
    onStart,
    onStop,
}: AudioRecorderProps) {
    return (
        <div className="flex items-center gap-3">
            <Button
                onClick={isRecording ? onStop : onStart}
                disabled={isModelLoading}
                variant={isRecording ? 'destructive' : 'default'}
                size="lg"
                className="min-w-[180px]"
            >
                {isModelLoading ? (
                    <>
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Loading Model...
                    </>
                ) : isRecording ? (
                    <>
                        <Square className="mr-2 h-4 w-4 fill-current" />
                        Stop
                    </>
                ) : (
                    <>
                        <Mic className="mr-2 h-4 w-4" />
                        Start Listening
                    </>
                )}
            </Button>

            {isRecording && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/20 text-destructive rounded-full animate-pulse">
                    <div className="h-2 w-2 rounded-full bg-destructive" />
                    <span className="text-sm font-medium">Recording</span>
                </div>
            )}
        </div>
    );
}
