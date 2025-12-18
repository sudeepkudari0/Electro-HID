import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Trash2, X, MessageCircle, Star } from 'lucide-react';

export interface QAPair {
    id: string;
    question: string;
    answer: string;
    timestamp: Date;
    isStreaming?: boolean;
}

interface AnswerWindowProps {
    qaPairs: QAPair[];
    currentIndex: number;
    onNavigate: (index: number) => void;
    onClear: () => void;
    onClose: () => void;
}

export function AnswerWindow({
    qaPairs,
    currentIndex,
    onNavigate,
    onClear,
    onClose,
}: AnswerWindowProps) {
    const [position, setPosition] = useState({ x: 100, y: 150 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

    const currentQA = qaPairs[currentIndex];

    if (!currentQA) return null;

    // Handle drag start
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return; // Don't drag when clicking buttons
        setIsDragging(true);
        setDragOffset({
            x: e.clientX - position.x,
            y: e.clientY - position.y,
        });
    };

    // Handle dragging
    const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        setPosition({
            x: e.clientX - dragOffset.x,
            y: e.clientY - dragOffset.y,
        });
    };

    // Handle drag end
    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Add/remove drag listeners
    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset]);

    // Format timestamp
    const formatTime = (date: Date): string => {
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Parse answer into bullet points if it contains bullet markers
    const parseAnswer = (answer: string): string[] => {
        // Split by bullet points (•, -, *, or numbered list)
        const lines = answer.split(/\n(?=[•\-*]|\d+\.)/);
        return lines.filter(line => line.trim());
    };

    const answerLines = parseAnswer(currentQA.answer);
    const hasBullets = answerLines.length > 1;

    return (
        <div
            className="fixed z-30 select-none pointer-events-none"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
            }}
        >
            <div
                className="bg-black/40 backdrop-blur-2xl rounded-lg shadow-2xl border border-white/20 w-[600px] max-w-[90vw] pointer-events-auto"
                style={{
                    cursor: isDragging ? 'grabbing' : 'grab',
                }}
                onMouseDown={handleMouseDown}
            >
                {/* Header with navigation */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        {/* Previous/Next navigation */}
                        <button
                            onClick={() => onNavigate(Math.max(0, currentIndex - 1))}
                            disabled={currentIndex === 0}
                            className="p-1.5 hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Previous"
                        >
                            <ChevronLeft className="w-4 h-4 text-white" />
                        </button>
                        <button
                            onClick={() => onNavigate(Math.min(qaPairs.length - 1, currentIndex + 1))}
                            disabled={currentIndex === qaPairs.length - 1}
                            className="p-1.5 hover:bg-white/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Next"
                        >
                            <ChevronRight className="w-4 h-4 text-white" />
                        </button>

                        {/* Counter */}
                        <span className="text-white/50 text-xs ml-2">
                            {currentIndex + 1} / {qaPairs.length}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClear}
                            className="p-1.5 hover:bg-white/10 rounded transition-colors"
                            title="Clear All"
                        >
                            <Trash2 className="w-4 h-4 text-white/70 hover:text-white" />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-white/10 rounded transition-colors"
                            title="Close"
                        >
                            <X className="w-4 h-4 text-white/70 hover:text-white" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 max-h-[70vh] overflow-y-auto">
                    {/* Question Section */}
                    <div className="flex items-start gap-3 mb-4">
                        <MessageCircle className="w-5 h-5 text-white mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <h3 className="text-white font-semibold text-base mb-1">Question:</h3>
                            <p className="text-white/90 text-base leading-relaxed">
                                {currentQA.question}
                            </p>
                        </div>
                    </div>

                    {/* Answer Section */}
                    <div className="flex items-start gap-3">
                        <Star className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                            <h3 className="text-white font-semibold text-base mb-3">Answer:</h3>

                            {hasBullets ? (
                                <ul className="space-y-3">
                                    {answerLines.map((line, index) => (
                                        <li
                                            key={index}
                                            className="text-white/90 text-base leading-relaxed pl-2"
                                        >
                                            {line.replace(/^[•\-*]\s*/, '').replace(/^\d+\.\s*/, '')}
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-white/90 text-base leading-relaxed whitespace-pre-wrap">
                                    {currentQA.answer}
                                </p>
                            )}

                            {/* Streaming indicator */}
                            {currentQA.isStreaming && (
                                <div className="flex items-center gap-2 mt-3">
                                    <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
                                    <span className="text-cyan-400 text-sm">Generating...</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Timestamp */}
                    <div className="mt-6 text-white/40 text-xs">
                        {formatTime(currentQA.timestamp)}
                    </div>
                </div>
            </div>
        </div>
    );
}
