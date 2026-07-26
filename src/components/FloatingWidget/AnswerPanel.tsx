import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Trash2, MessageSquare, ChevronDown, ChevronRight as ChevronRightIcon, List, AlignLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { IconButton } from '../shared/IconButton';
import { CopyButton } from '../shared/CopyButton';
import { useUIStore } from '../../state/ui-store';
import type { Answer } from '../../state';

interface AnswerPanelProps {
    answers: Answer[];
    currentIndex: number;
    onNavigate: (index: number) => void;
    onClear: () => void;
}

// Deterministic post-processing safety net for banned vocabulary
function cleanBannedWords(text: string): string {
    if (!text) return '';
    const replacements: Record<string, string> = {
        'delve': 'explore',
        'spearhead': 'lead',
        'spearheaded': 'led',
        'testament': 'proof',
        'crucial': 'key',
        'robust': 'solid',
        'holistic': 'overall',
        'moreover': 'also',
        'furthermore': 'plus',
        'synergy': 'alignment',
        'paradigm': 'model',
        'passionate': 'motivated',
        'results-driven': 'focused'
    };
    let result = text;
    for (const [banned, replacement] of Object.entries(replacements)) {
        const regex = new RegExp(`\\b${banned}\\b`, 'gi');
        result = result.replace(regex, replacement);
    }
    return result;
}

import { parseProgressiveJson } from '../../lib/prompts/parse-json';


export function AnswerPanel({ answers, currentIndex, onNavigate, onClear }: AnswerPanelProps) {
    const { useBulletPoints, toggleBulletPoints } = useUIStore();
    const [showFollowUps, setShowFollowUps] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const current = answers[currentIndex];

    // Reset follow-ups toggle when answer changes
    useEffect(() => {
        setShowFollowUps(false);
    }, [currentIndex]);

    if (!current) return null;

    const cleanedAnswerText = cleanBannedWords(current.answer || '');
    const structuredJson = parseProgressiveJson(cleanedAnswerText);

    return (
        <div className="panel-section animate-slide-up">
            {/* Section header with navigation */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        AI Response
                    </span>
                    {current.detectedType && current.detectedType !== 'general' && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 ml-1">
                            Detected: {current.detectedType.replace('-', ' ')}
                        </span>
                    )}

                    {/* Answer counter */}
                    {answers.length > 1 && (
                        <span className="text-[10px] text-[var(--text-muted)] ml-1">
                            {currentIndex + 1}/{answers.length}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-0.5">
                    {/* Navigation arrows */}
                    {answers.length > 1 && (
                        <>
                            <IconButton
                                id="btn-prev-answer"
                                onClick={() => onNavigate(Math.max(0, currentIndex - 1))}
                                title="Previous answer"
                                disabled={currentIndex === 0}
                            >
                                <ChevronLeft className="w-3 h-3" />
                            </IconButton>
                            <IconButton
                                id="btn-next-answer"
                                onClick={() => onNavigate(Math.min(answers.length - 1, currentIndex + 1))}
                                title="Next answer"
                                disabled={currentIndex === answers.length - 1}
                            >
                                <ChevronRight className="w-3 h-3" />
                            </IconButton>
                        </>
                    )}

                    <IconButton
                        id="btn-clear-answers"
                        onClick={onClear}
                        title="Clear all answers"
                    >
                        <Trash2 className="w-3 h-3" />
                    </IconButton>
                </div>
            </div>

            {/* Source badge */}
            <div className="px-4 pt-3 pb-1">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                    ${current.source === 'screen-capture'
                        ? 'bg-[var(--accent-purple-dim)] text-[var(--accent-purple)]'
                        : 'bg-[var(--accent-blue-dim)] text-[var(--accent-blue)]'
                    }`}
                >
                    {current.source === 'screen-capture' ? '📷 Screen Capture' : '🎙️ Transcript'}
                </span>
            </div>

            {/* Answer content */}
            <div
                ref={scrollRef}
                className="px-4 py-3 max-h-[300px] overflow-y-auto select-text"
            >
                {/* Question/context */}
                {current.question && current.source === 'transcript' && (
                    <div className="mb-3 pb-3 border-b border-[var(--border-subtle)]">
                        <p className="text-xs text-[var(--text-muted)] mb-1 font-medium">Question:</p>
                        <p className="text-sm text-[var(--text-secondary)] line-clamp-3">
                            {current.question}
                        </p>
                    </div>
                )}

                {/* Answer text */}
                <div className="text-sm leading-relaxed text-[var(--text-primary)] answer-content select-text prose prose-invert prose-sm max-w-none">
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
                    ) : (cleanedAnswerText.trim().startsWith('{') || cleanedAnswerText.trim().startsWith('```')) && current.isStreaming ? (
                        <div className="flex items-center gap-2 text-xs text-indigo-400 py-2 animate-pulse font-medium">
                            <span>⏳</span>
                            <span>Formatting teleprompter notes...</span>
                        </div>
                    ) : current.answer ? (
                        <ReactMarkdown
                            components={{
                                code({ node, className, children, ...props }) {
                                    const match = /language-(\w+)/.exec(className || '');
                                    const isInline = !match;
                                    if (isInline) {
                                        return (
                                            <code
                                                className="bg-zinc-800 text-emerald-400 px-1.5 py-0.5 rounded text-xs font-mono"
                                                {...props}
                                            >
                                                {children}
                                            </code>
                                        );
                                    }
                                    const lang = match ? match[1] : '';
                                    const codeString = String(children).replace(/\n$/, '');
                                    return (
                                        <div className="relative group my-3 rounded-lg overflow-hidden border border-zinc-700/50">
                                            <div className="flex items-center justify-between bg-zinc-800/80 px-3 py-1.5 border-b border-zinc-700/50">
                                                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                                                    {lang || 'code'}
                                                </span>
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(codeString)}
                                                    className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-all opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto duration-200"
                                                >
                                                    Copy
                                                </button>
                                            </div>
                                            <pre 
                                                className="!bg-zinc-900 !m-0 p-3 overflow-x-auto w-full max-w-full"
                                                style={{ whiteSpace: 'pre', wordBreak: 'normal', overflowWrap: 'normal' }}
                                            >
                                                <code 
                                                    className={`${className || ''} text-xs font-mono leading-relaxed`}
                                                    style={{ whiteSpace: 'pre', wordBreak: 'normal', overflowWrap: 'normal' }}
                                                    {...props}
                                                >
                                                    {children}
                                                </code>
                                            </pre>
                                        </div>
                                    );
                                },
                            }}
                        >
                            {cleanedAnswerText}
                        </ReactMarkdown>
                    ) : (
                        <span className="text-[var(--text-muted)]">Generating...</span>
                    )}

                    {/* Streaming cursor */}
                    {current.isStreaming && (
                        <span className="streaming-cursor" />
                    )}
                </div>

                {/* Follow-ups */}
                {current.followUps && current.followUps.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
                        <button 
                            onClick={() => setShowFollowUps(!showFollowUps)}
                            className="flex items-center text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                            {showFollowUps ? <ChevronDown className="w-3.5 h-3.5 mr-1" /> : <ChevronRightIcon className="w-3.5 h-3.5 mr-1" />}
                            Likely Follow-up Questions
                        </button>
                        
                        {showFollowUps && (
                            <ul className="mt-2 space-y-2 animate-fade-in pl-1">
                                {current.followUps.map((q, i) => (
                                    <li key={i} className="text-xs text-zinc-300 flex items-start gap-1.5">
                                        <MessageSquare className="w-3 h-3 text-indigo-500/70 mt-0.5 shrink-0" />
                                        <span>{q}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>

            {/* Footer actions */}
            {current.answer && !current.isStreaming && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-subtle)]">
                    <span className="text-[10px] text-[var(--text-muted)]">
                        {current.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleBulletPoints}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                useBulletPoints 
                                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' 
                                    : 'bg-zinc-800 text-zinc-400 hover:text-white border border-transparent'
                            }`}
                            title="Toggle Bullet Points for future answers"
                        >
                            {useBulletPoints ? <List className="w-3 h-3" /> : <AlignLeft className="w-3 h-3" />}
                            Bullets
                        </button>
                        <CopyButton text={current.answer} />
                    </div>
                </div>
            )}
        </div>
    );
}
