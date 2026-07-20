import { useState, useRef, useEffect } from 'react';
import { Trash2, Sparkles, Copy, Check, Zap, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { parseProgressiveJson } from '../../lib/prompts/parse-json';
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
}: {
    candidate: CandidateQuestion;
    onPick: (id: string, text: string) => void;
    onDismiss: (id: string) => void;
}) {
    const isAnswering = candidate.status === 'answering';
    const isAnswered = candidate.status === 'answered';
    const hasAnswer = !!candidate.answer;
    const [copied, setCopied] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const structuredJson = parseProgressiveJson(candidate.answer || '');

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
                            <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                                isAnswering ? 'text-amber-400'
                                : isAnswered ? 'text-emerald-400'
                                : 'text-cyan-500/60'
                            }`}>
                                {isAnswering ? 'Generating answer...' : isAnswered ? 'Answered' : 'Detected Question'}
                            </span>
                            {/* Confidence badge */}
                            <span className="text-[9px] text-zinc-600 ml-auto">
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
                                className="text-zinc-600 hover:text-zinc-400 transition-colors p-0.5"
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
                        className="px-3.5 py-3 max-h-[300px] overflow-y-auto select-text"
                    >
                        <div className="text-[13px] leading-relaxed text-[var(--text-primary)] answer-content select-text prose prose-invert prose-sm max-w-none">
                            {structuredJson ? (
                                <div className="space-y-3.5 animate-fade-in">
                                    {structuredJson.hook && (
                                        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 mb-1">
                                                <span>🎯</span>
                                                <span>Direct Hook</span>
                                            </div>
                                            <p className="text-sm font-medium text-indigo-100 leading-snug">
                                                {structuredJson.hook}
                                            </p>
                                        </div>
                                    )}

                                    {structuredJson.points && structuredJson.points.length > 0 && (
                                        <div className="space-y-2 px-1">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
                                                <span>💬</span>
                                                <span>Key Talking Points</span>
                                            </div>
                                            <ul className="space-y-2">
                                                {structuredJson.points.map((point, idx) => (
                                                    <li key={idx} className="flex items-start gap-2.5 text-sm text-zinc-200">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 shrink-0 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                                                        <span className="leading-relaxed">{point}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {structuredJson.edgeCase && (
                                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mt-2">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 mb-1">
                                                <span>⚠️</span>
                                                <span>Edge Case / Nuance</span>
                                            </div>
                                            <p className="text-xs font-medium text-amber-200/90 leading-snug">
                                                {structuredJson.edgeCase}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            ) : (candidate.answer?.trim().startsWith('{') || candidate.answer?.trim().startsWith('```')) && candidate.isStreaming ? (
                                <div className="flex items-center gap-2 text-xs text-indigo-400 py-2 animate-pulse font-medium">
                                    <span>⏳</span>
                                    <span>Formatting teleprompter notes...</span>
                                </div>
                            ) : (
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
                                                <pre className="!bg-zinc-900 !m-0 p-3 rounded-lg overflow-x-auto my-2 border border-zinc-700/50">
                                                    <code className={`${className || ''} text-xs font-mono`} {...props}>{children}</code>
                                                </pre>
                                            );
                                        },
                                    }}
                                >
                                    {candidate.answer}
                                </ReactMarkdown>
                            )}
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

    // Auto-scroll to top when new questions arrive
    useEffect(() => {
        if (scrollRef.current && candidateQuestions.length > 0) {
            scrollRef.current.scrollTop = 0;
        }
    }, [candidateQuestions.length]);

    const totalCount = candidateQuestions.length;

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">
                        AI Answer Suggestions
                    </span>
                    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700/50">
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                        <span className="text-[9px] text-zinc-400 font-medium">Ollama</span>
                    </div>
                </div>
                {totalCount > 0 && (
                    <button
                        onClick={onClearAll}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                        title="Clear all suggestions"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Content */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3">
                {totalCount === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12">
                        <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700/50 flex items-center justify-center mb-3">
                            <Sparkles className="w-5 h-5 text-zinc-600" />
                        </div>
                        <p className="text-xs text-zinc-500 max-w-[200px]">
                            Detected questions will appear here — click one to generate an answer
                        </p>
                    </div>
                ) : (
                    <>
                        {/* All candidate questions (pending, answering, and answered) */}
                        {candidateQuestions.map((candidate) => (
                            <CandidateCard
                                key={candidate.id}
                                candidate={candidate}
                                onPick={onPickQuestion}
                                onDismiss={onDismissCandidate}
                            />
                        ))}
                    </>
                )}
            </div>
        </div>
    );
}
