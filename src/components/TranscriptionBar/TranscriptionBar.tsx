import { useRef, useEffect } from 'react';
import { Trash2, ChevronDown, X } from 'lucide-react';

interface TranscriptionBarProps {
    transcript: string;
    onClear: () => void;
    onToggleExpand?: () => void;
    onClose?: () => void;
}

export function TranscriptionBar({
    transcript,
    onClear,
    onToggleExpand,
    onClose,
}: TranscriptionBarProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to end as new text comes in
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [transcript]);

    if (!transcript) return null;

    return (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-40 w-[90%] max-w-5xl select-none pointer-events-none">
            <div className="bg-black/25 backdrop-blur-xl rounded-lg shadow-2xl border border-white/20 overflow-hidden pointer-events-auto">
                <div className="flex items-center">
                    {/* Transcript Text - Single line, horizontal scroll */}
                    <div
                        ref={scrollRef}
                        className="flex-1 px-4 py-3 overflow-x-auto overflow-y-hidden whitespace-nowrap scrollbar-hide"
                        style={{
                            scrollbarWidth: 'none',
                            msOverflowStyle: 'none',
                        }}
                    >
                        <p className="text-white text-sm font-normal">
                            {transcript}
                        </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 px-3 border-l border-white/10">
                        <button
                            onClick={onClear}
                            className="p-2 hover:bg-white/10 rounded transition-colors"
                            title="Clear Transcript"
                        >
                            <Trash2 className="w-4 h-4 text-white/70 hover:text-white" />
                        </button>

                        {onToggleExpand && (
                            <button
                                onClick={onToggleExpand}
                                className="p-2 hover:bg-white/10 rounded transition-colors"
                                title="Expand"
                            >
                                <ChevronDown className="w-4 h-4 text-white/70 hover:text-white" />
                            </button>
                        )}

                        {onClose && (
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-white/10 rounded transition-colors"
                                title="Close"
                            >
                                <X className="w-4 h-4 text-white/70 hover:text-white" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Hide scrollbar CSS */}
            <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
        </div>
    );
}
