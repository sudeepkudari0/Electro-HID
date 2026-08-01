import { useState, useRef, useEffect } from 'react';
import { Trash2, Sparkles, Copy, Check, Zap, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useUIStore } from '../../state/ui-store';
import type { CandidateQuestion, DetectedQuestion } from '../../state';

interface AnswerSuggestionsProps {
    candidateQuestions: CandidateQuestion[];
    detectedQuestions: DetectedQuestion[];
    expandedQuestionId: string | null;
    onPickQuestion: (candidateId: string, questionText: string) => void;
    onDismissCandidate: (candidateId: string) => void;
    onSelectOption: (questionId: string, optionId: string) => void;
    onClearAll: () => void;
}

// ─── Candidate Question Card with inline answer ───

function CandidateCard({
    candidate,
    onPick,
    onDismiss,
    autoScroll,
}: {
    candidate: CandidateQuestion;
    onPick: (id: string, text: string) => void;
    onDismiss: (id: string) => void;
    autoScroll: boolean;
}) {
    const isAnswering = candidate.status === 'answering';
    const isAnswered = candidate.status === 'answered';
    const hasAnswer = !!candidate.answer;
    const [copied, setCopied] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll disabled — user controls scroll position

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (candidate.answer) {
            await navigator.clipboard.writeText(candidate.answer);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleToggleCollapse = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsCollapsed(prev => !prev);
    };

    return (
        <div
            className={`
                rounded-xl border transition-all duration-200
                ${isAnswering
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : isAnswered
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-zinc-700/50 bg-zinc-800/30 hover:border-cyan-500/30 hover:bg-cyan-500/5 cursor-pointer hover:shadow-[0_0_20px_rgba(6,182,212,0.06)]'
                }
            `}
            onClick={() => !isAnswering && !isAnswered && onPick(candidate.id, candidate.text)}
        >
            <div className="px-3.5 py-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        {/* Status indicator */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                            {isAnswering ? (
                                <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
                            ) : isAnswered ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                                <Zap className="w-3 h-3 text-cyan-500/60" />
                            )}
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${isAnswering ? 'text-amber-400'
                                    : isAnswered ? 'text-emerald-400'
                                        : 'text-cyan-500/60'
                                }`}>
                                {isAnswering ? 'Generating answer...' : isAnswered ? 'Answered' : 'Detected Question'}
                            </span>
                            {/* Confidence badge */}
                            <span className="text-[9px] text-zinc-650 ml-auto">
                                {Math.round(candidate.confidence * 100)}%
                            </span>
                        </div>

                        {/* Question text */}
                        <p className={`text-[13px] leading-relaxed text-zinc-200 ${!hasAnswer ? 'line-clamp-3' : ''}`}>
                            {candidate.text}
                        </p>

                        {/* Click hint for pending questions */}
                        {!isAnswering && !isAnswered && (
                            <p className="text-[10px] text-cyan-500/40 mt-2 flex items-center gap-1">
                                <Sparkles className="w-3 h-3" />
                                Click to generate answer
                            </p>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                        {/* Collapse/expand toggle for answered questions */}
                        {hasAnswer && !candidate.isStreaming && (
                            <button
                                onClick={handleToggleCollapse}
                                className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
                                title={isCollapsed ? 'Expand answer' : 'Collapse answer'}
                            >
                                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                        )}
                        {/* Copy button for answered questions */}
                        {hasAnswer && !candidate.isStreaming && (
                            <button
                                onClick={handleCopy}
                                className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
                                title="Copy answer"
                            >
                                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                        )}
                        {/* Dismiss button */}
                        {!isAnswering && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onDismiss(candidate.id); }}
                                className="text-zinc-650 hover:text-zinc-450 transition-colors p-0.5"
                                title="Dismiss"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ─── Inline Answer Section ─── */}
            {hasAnswer && !isCollapsed && (
                <div className="border-t border-zinc-700/30">
                    <div
                        ref={scrollRef}
                        className="px-3.5 py-3 max-h-[400px] overflow-y-auto select-text"
                    >
                        <div className="text-[13px] leading-relaxed text-[var(--text-primary)] answer-content select-text prose prose-invert prose-sm max-w-none">
                            {candidate.answer ? (
                                <ReactMarkdown
                                    components={{
                                        code({ className, children, ...props }) {
                                            const match = /language-(\w+)/.exec(className || '');
                                            const isInline = !match;
                                            if (isInline) {
                                                return (
                                                    <code className="bg-zinc-800 text-emerald-400 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                                                        {children}
                                                    </code>
                                                );
                                            }
                                            return (
                                                <pre
                                                    className="!bg-zinc-900 !m-0 p-3 rounded-lg overflow-x-auto my-2 border border-zinc-700/50"
                                                    style={{ whiteSpace: 'pre', wordBreak: 'normal', overflowWrap: 'normal' }}
                                                >
                                                    <code
                                                        className={`${className || ''} text-xs font-mono`}
                                                        style={{ whiteSpace: 'pre', wordBreak: 'normal', overflowWrap: 'normal' }}
                                                        {...props}
                                                    >
                                                        {children}
                                                    </code>
                                                </pre>
                                            );
                                        },
                                    }}
                                >
                                    {candidate.answer}
                                </ReactMarkdown>
                            ) : null}

                            {candidate.isStreaming && <span className="streaming-cursor" />}
                        </div>
                    </div>
                </div>
            )}

            {/* Streaming placeholder (when streaming but no content yet) */}
            {isAnswering && !hasAnswer && (
                <div className="border-t border-zinc-700/30 px-3.5 py-3">
                    <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-xs text-zinc-500">Generating answer...</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Main Component ───

export function AnswerSuggestions({
    candidateQuestions,
    onPickQuestion,
    onDismissCandidate,
    onClearAll,
}: AnswerSuggestionsProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const { autoScroll, toggleAutoScroll } = useUIStore();

    // Auto-scroll to top when new questions arrive
    useEffect(() => {
        if (autoScroll && scrollRef.current) {
            scrollRef.current.scrollTop = 0;
        }
    }, [candidateQuestions.length, autoScroll]);

    return (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Header / Actions */}
            <div className="px-4 py-2.5 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0 bg-zinc-900/30">
                <span className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span>Real-time Suggestions</span>
                </span>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-zinc-400 font-medium">
                            Auto Scroll
                        </span>
                        <button
                            onClick={toggleAutoScroll}
                            className={`toggle-switch ${autoScroll ? 'toggle-switch--active' : ''}`}
                            title="Toggle auto scroll"
                        >
                            <div className="toggle-switch__knob" />
                        </button>
                    </div>
                    {candidateQuestions.length > 0 && (
                        <button
                            onClick={onClearAll}
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
                        >
                            <Trash2 className="w-3.5 h-3.5" /> Clear All
                        </button>
                    )}
                </div>
            </div>

            {/* List area */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3 scrollbar-none"
            >
                {candidateQuestions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-8 text-center">
                        <div className="w-10 h-10 rounded-full bg-zinc-800/80 flex items-center justify-center border border-zinc-700/50 mb-3">
                            <Sparkles className="w-5 h-5 text-zinc-500" />
                        </div>
                        <p className="text-xs text-zinc-400 font-medium">Listening for interview questions...</p>
                        <p className="text-[10px] text-zinc-500 mt-1 max-w-[200px]">Questions will display here with guided speaking notes.</p>
                    </div>
                ) : (
                    candidateQuestions.map(q => (
                        <CandidateCard
                            key={q.id}
                            candidate={q}
                            onPick={onPickQuestion}
                            onDismiss={onDismissCandidate}
                            autoScroll={autoScroll}
                        />
                    ))
                )}
            </div>
        </div>
    );
}
