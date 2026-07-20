import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Minus, Plus, ChevronUp, ChevronDown } from 'lucide-react';
import type { CandidateQuestion } from '../../state';

interface TeleprompterViewProps {
    candidateQuestions: CandidateQuestion[];
}

export function TeleprompterView({ candidateQuestions }: TeleprompterViewProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [fontSize, setFontSize] = useState(36);
    const [opacity, setOpacity] = useState(100);
    const [isHoveringControls, setIsHoveringControls] = useState(false);

    // Find the most relevant question to show:
    // 1. The one currently generating an answer
    // 2. Or the most recently answered one
    const activeQuestion = [...candidateQuestions]
        .reverse()
        .find(q => q.status === 'answering' || q.status === 'answered');

    // Auto-scroll to bottom during streaming
    useEffect(() => {
        // Only auto-scroll if we are not manually scrolling via controls
        if (activeQuestion?.isStreaming && scrollRef.current && !isHoveringControls) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [activeQuestion?.answer, activeQuestion?.isStreaming, isHoveringControls]);

    const handleScroll = (direction: 'up' | 'down') => {
        if (scrollRef.current) {
            const amount = direction === 'up' ? -100 : 100;
            scrollRef.current.scrollBy({ top: amount, behavior: 'smooth' });
        }
    };

    const isLinux = window.electronAPI?.platform === 'linux';

    const handleMouseEnterControls = () => {
        setIsHoveringControls(true);
        if (!isLinux) window.electronAPI?.setIgnoreMouseEvents(false);
    };

    const handleMouseLeaveControls = () => {
        setIsHoveringControls(false);
        if (!isLinux) window.electronAPI?.setIgnoreMouseEvents(true);
    };

    if (!activeQuestion) {
        return (
            <div className="flex items-center justify-center h-full w-full opacity-50 select-none pointer-events-none">
                <span className="text-xl text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] font-medium tracking-wider">
                    Waiting for questions...
                </span>
            </div>
        );
    }

    return (
        <div className="flex-1 w-full h-full relative pointer-events-none">
            {/* Control Bar */}
            <div
                className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-4 px-4 py-2 bg-zinc-900/80 backdrop-blur-md rounded-full border border-zinc-700/50 shadow-2xl pointer-events-auto z-[9999] opacity-20 hover:opacity-100 transition-opacity duration-300"
                onMouseEnter={handleMouseEnterControls}
                onMouseLeave={handleMouseLeaveControls}
                onWheel={(e) => {
                    if (scrollRef.current) {
                        scrollRef.current.scrollBy({ top: e.deltaY, behavior: 'auto' });
                    }
                }}
            >
                <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400 font-medium">Size</span>
                    <button onClick={() => setFontSize(f => Math.max(16, f - 4))} className="p-1 hover:bg-zinc-700 rounded text-zinc-300">
                        <Minus className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-white w-6 text-center">{fontSize}</span>
                    <button onClick={() => setFontSize(f => Math.min(120, f + 4))} className="p-1 hover:bg-zinc-700 rounded text-zinc-300">
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                <div className="w-px h-4 bg-zinc-700"></div>

                <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400 font-medium">Opacity</span>
                    <button onClick={() => setOpacity(o => Math.max(10, o - 10))} className="p-1 hover:bg-zinc-700 rounded text-zinc-300">
                        <Minus className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-white w-8 text-center">{opacity}%</span>
                    <button onClick={() => setOpacity(o => Math.min(100, o + 10))} className="p-1 hover:bg-zinc-700 rounded text-zinc-300">
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                <div className="w-px h-4 bg-zinc-700"></div>

                <div className="flex items-center gap-1">
                    <button onClick={() => handleScroll('up')} className="p-1 hover:bg-zinc-700 rounded text-zinc-300" title="Scroll Up">
                        <ChevronUp className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleScroll('down')} className="p-1 hover:bg-zinc-700 rounded text-zinc-300" title="Scroll Down">
                        <ChevronDown className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div
                ref={scrollRef}
                className="w-full h-full overflow-y-auto overflow-x-hidden flex flex-col items-center p-8 select-none pointer-events-none custom-scrollbar"
                style={{ opacity: opacity / 100 }}
            >
                <div className="max-w-4xl w-full mx-auto flex flex-col gap-6 pb-32 pt-16">
                    {/* Optional: Show question text slightly smaller above */}
                    <div
                        className="text-cyan-300 opacity-80 drop-shadow-[0_2px_4px_rgba(0,0,0,1)] font-medium"
                        style={{ fontSize: `${Math.max(14, fontSize * 0.6)}px` }}
                    >
                        {activeQuestion.text}
                    </div>

                    {/* Main Answer Text */}
                    <div
                        className="leading-[1.4] text-white font-bold drop-shadow-[0_4px_6px_rgba(0,0,0,0.9)] text-shadow-heavy transition-all duration-200"
                        style={{ fontSize: `${fontSize}px` }}
                    >
                        {activeQuestion.answer ? (
                            <ReactMarkdown
                                components={{
                                    p: ({ children }) => <p className="mb-4">{children}</p>,
                                    code: ({ children }) => (
                                        <span className="font-mono text-emerald-300 drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">{children}</span>
                                    )
                                }}
                            >
                                {activeQuestion.answer}
                            </ReactMarkdown>
                        ) : (
                            <span className="text-amber-400 opacity-80 animate-pulse">
                                Thinking...
                            </span>
                        )}
                        {activeQuestion.isStreaming && <span className="inline-block w-3 h-8 bg-white ml-2 animate-pulse" />}
                    </div>
                </div>
            </div>
        </div>
    );
}