import { useRef, useEffect, useState, useCallback } from 'react';
import { WidgetHeader } from './WidgetHeader';
import { AnswerSuggestions } from './AnswerSuggestions';

import { ChatPanel } from '../ChatPanel/ChatPanel';
import { SessionHistory } from '../SessionHistory/SessionHistory';
import { SessionDetail } from '../SessionHistory/SessionDetail';
import { TeleprompterView } from './TeleprompterView';
import { PracticeMode } from '../PracticeMode/PracticeMode';
import { MetricsBar } from '../DeliveryMetrics/MetricsBar';
import { Shield } from 'lucide-react';
import type { ChatBlock, DetectedQuestion, CandidateQuestion } from '../../state';
import { useResize } from '../../hooks/useResize';
import { useUIStore } from '../../state/ui-store';
import './FloatingWidget.css';

interface FloatingWidgetProps {
    // State
    isExpanded: boolean;
    isChatOpen: boolean;
    isHistoryOpen: boolean;
    isPracticeOpen: boolean;
    isRecording: boolean;
    isCapturing: boolean;
    isGenerating: boolean;
    isTeleprompterMode: boolean;
    sessionTime: number;
    conversation: ChatBlock[];
    isModelLoading: boolean;
    modelError: string;

    // New: Question detection model
    candidateQuestions: CandidateQuestion[];
    detectedQuestions: DetectedQuestion[];
    expandedQuestionId: string | null;
    autoDetectionEnabled: boolean;
    sttEngine: string;
    sttModel: string;
    audioLevels: { mic: number; system: number };

    // Actions
    onToggleExpanded: () => void;
    onToggleRecording: () => void;
    onCaptureScreen: () => void;
    onGenerateAnswer: () => void;
    onClearTranscript: () => void;
    onToggleChat: () => void;
    onToggleHistory: () => void;
    onTogglePractice: () => void;
    onClose: () => void;

    // New actions
    onPickQuestion: (candidateId: string, questionText: string) => void;
    onDismissCandidate: (candidateId: string) => void;
    onSelectOption: (questionId: string, optionId: string) => void;
    onClearDetectedQuestions: () => void;
    onToggleAutoDetection: () => void;
}

export function FloatingWidget({
    isExpanded,
    isChatOpen,
    isHistoryOpen,
    isPracticeOpen,
    isRecording,
    isCapturing,
    isGenerating,
    isTeleprompterMode,
    sessionTime,
    conversation,
    isModelLoading,
    modelError,
    candidateQuestions,
    detectedQuestions,
    expandedQuestionId,
    autoDetectionEnabled,
    sttEngine,
    sttModel,
    audioLevels,
    onToggleExpanded,
    onToggleRecording,
    onCaptureScreen,
    onGenerateAnswer,
    onClearTranscript,
    onToggleChat,
    onToggleHistory,
    onTogglePractice,
    onClose,
    onPickQuestion,
    onDismissCandidate,
    onSelectOption,
    onClearDetectedQuestions,
    onToggleAutoDetection,
}: FloatingWidgetProps) {
    const widgetRef = useRef<HTMLDivElement>(null);
    const liveTranscriptRef = useRef<HTMLDivElement>(null);
    const prevCandidateCount = useRef(candidateQuestions.length);
    const [selectedSession, setSelectedSession] = useState<any>(null);

    // Safe cursor mode states
    const safeCursorMode = useUIStore((state) => state.safeCursorMode);
    const isHidden = useUIStore((state) => state.isHidden);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [isHovered, setIsHovered] = useState(false);
    const [cursorType, setCursorType] = useState('default');

    const updateCursorType = useCallback((el: HTMLElement | null) => {
        if (!el) {
            setCursorType('default');
            return;
        }
        let current: HTMLElement | null = el;
        while (current && current !== document.body) {
            if (current.classList.contains('resize-handle-left')) {
                setCursorType('ew-resize');
                return;
            }
            if (current.classList.contains('resize-handle-bottom')) {
                setCursorType('ns-resize');
                return;
            }
            if (current.classList.contains('resize-handle-bottom-left')) {
                setCursorType('nesw-resize');
                return;
            }
            if (
                current.classList.contains('drag-handle-teleprompter') || 
                current.id === 'widget-header' ||
                current.classList.contains('widget-header')
            ) {
                setCursorType('grab');
                return;
            }
            if (
                current.tagName === 'INPUT' || 
                current.tagName === 'TEXTAREA' || 
                current.classList.contains('select-text') || 
                current.classList.contains('selectable-text')
            ) {
                setCursorType('text');
                return;
            }
            if (
                current.tagName === 'BUTTON' ||
                current.tagName === 'A' ||
                current.tagName === 'SELECT' ||
                current.classList.contains('toggle-switch') ||
                current.classList.contains('clickable') ||
                current.classList.contains('cursor-pointer') ||
                current.getAttribute('role') === 'button' ||
                (current as any).onclick
            ) {
                setCursorType('pointer');
                return;
            }
            current = current.parentElement;
        }
        setCursorType('default');
    }, []);

    const handleMouseMove = (e: React.MouseEvent) => {
        setMousePos({ x: e.clientX, y: e.clientY });
        if (safeCursorMode) {
            updateCursorType(e.target as HTMLElement);
        }
    };

    // Auto-scroll live transcript to the right as text grows
    useEffect(() => {
        if (liveTranscriptRef.current) {
            liveTranscriptRef.current.scrollLeft = liveTranscriptRef.current.scrollWidth;
        }
    }, [conversation]);
    const widgetOpacity = useUIStore((state) => state.widgetOpacity);
    const isLinux = window.electronAPI?.platform === 'linux';

    // ─── Widget CSS position (for drag on macOS/Windows) ───
    const [widgetPos, setWidgetPos] = useState({ top: 16, right: 16 });

    const handleDrag = useCallback((deltaX: number, deltaY: number) => {
        if (isLinux) {
            // Linux: move the actual Electron window
            window.electronAPI?.moveWindow(deltaX, deltaY);
        } else {
            // macOS/Windows: CSS reposition within the full-screen overlay
            setWidgetPos(prev => ({
                top: Math.max(0, prev.top + deltaY),
                right: Math.max(0, prev.right - deltaX),
            }));
        }
    }, [isLinux]);

    // ─── Widget Size (for resize) ───
    const [widgetSize, setWidgetSize] = useState({ width: 580, height: -1 });

    const handleResize = useCallback((deltaW: number, deltaH: number, edge: 'left' | 'bottom' | 'bottom-left') => {
        setWidgetSize(prev => {
            const currentHeight = prev.height === -1 && widgetRef.current ? widgetRef.current.offsetHeight : prev.height;
            const newWidth = edge === 'left' || edge === 'bottom-left' ? Math.max(400, prev.width - deltaW) : prev.width;
            const newHeight = edge === 'bottom' || edge === 'bottom-left' ? Math.max(300, currentHeight + deltaH) : prev.height;
            return { width: newWidth, height: newHeight };
        });
    }, []);

    const { onMouseDown: onResizeLeft } = useResize((dW, dH) => handleResize(dW, dH, 'left'));
    const { onMouseDown: onResizeBottom } = useResize((dW, dH) => handleResize(dW, dH, 'bottom'));
    const { onMouseDown: onResizeBottomLeft } = useResize((dW, dH) => handleResize(dW, dH, 'bottom-left'));

    // Reset selected session when history is toggled
    useEffect(() => {
        if (!isHistoryOpen) {
            setSelectedSession(null);
        }
    }, [isHistoryOpen]);

    const handleLoadSession = async (id: string) => {
        try {
            const res = await window.electronAPI.session.load(id);
            if (res.success && res.session) {
                setSelectedSession(res.session);
            }
        } catch (error) {
            console.error('Failed to load session details:', error);
        }
    };

    // ─── Linux: Sync widget dimensions to Electron window ───
    useEffect(() => {
        if (!isLinux) return;
        const el = widgetRef.current;
        if (!el) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    (window as any).electronAPI?.setWindowSize?.(
                        Math.ceil(width) + 2, // +2 for border
                        Math.ceil(height) + 2,
                    );
                }
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [isLinux]);

    // ─── Click-through management (macOS/Windows only) ───
    // On Linux, the window only covers the widget area, so no click-through needed.
    useEffect(() => {
        if (isLinux) return;

        if (isHidden) {
            window.electronAPI?.setIgnoreMouseEvents(true);
            return;
        }

        const el = widgetRef.current;
        if (!el) return;

        const handleEnter = () => {
            if (!isTeleprompterMode && !isHidden) {
                window.electronAPI?.setIgnoreMouseEvents(false);
            }
        };
        const handleLeave = () => {
            window.electronAPI?.setIgnoreMouseEvents(true);
        };

        // If teleprompter mode turns on while mouse is already inside, force click-through
        if (isTeleprompterMode) {
            window.electronAPI?.setIgnoreMouseEvents(true);
        }

        el.addEventListener('mouseenter', handleEnter);
        el.addEventListener('mouseleave', handleLeave);

        return () => {
            el.removeEventListener('mouseenter', handleEnter);
            el.removeEventListener('mouseleave', handleLeave);
        };
    }, [isTeleprompterMode, isLinux, isHidden]);

    // Auto-expand when new candidate questions arrive
    useEffect(() => {
        if (candidateQuestions.length > prevCandidateCount.current) {
            if (!isExpanded) {
                onToggleExpanded();
            }
        }
        prevCandidateCount.current = candidateQuestions.length;
    }, [candidateQuestions.length, isExpanded, onToggleExpanded]);

    const isFullPagePanel = isChatOpen || isHistoryOpen || isPracticeOpen;

    const handleClearAll = () => {
        onClearDetectedQuestions();
    };

    return (
        <div className={`fixed top-0 right-0 w-full h-full select-none z-50 ${isLinux ? '' : 'pointer-events-none'}`}>
            <div
                ref={widgetRef}
                className={`widget ${isLinux ? '' : 'pointer-events-auto'} ${isExpanded ? 'widget--expanded' : 'widget--collapsed'} ${isTeleprompterMode ? 'widget--teleprompter' : ''} ${safeCursorMode ? 'widget-cursor-safe' : ''}`}
                id="floating-widget"
                onMouseMove={handleMouseMove}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{
                    ...(isHidden ? { display: 'none' } : {}),
                    ...(isLinux ? {
                        position: 'relative',
                        top: 0,
                        right: 0,
                        opacity: isTeleprompterMode ? undefined : widgetOpacity / 100,
                        ...(isTeleprompterMode ? {
                            width: `${window.screen.width}px`,
                            height: `${window.screen.height}px`,
                        } : isExpanded ? {
                            width: `${widgetSize.width}px`,
                            height: widgetSize.height !== -1 ? `${widgetSize.height}px` : undefined,
                            maxHeight: widgetSize.height !== -1 ? 'none' : `${Math.floor(window.screen.availHeight * 0.88)}px`,
                        } : {
                            width: '580px',
                        }),
                    } : {
                        top: isTeleprompterMode ? 0 : `${widgetPos.top}px`,
                        right: isTeleprompterMode ? 0 : `${widgetPos.right}px`,
                        opacity: isTeleprompterMode ? undefined : widgetOpacity / 100,
                        ...(isExpanded && !isTeleprompterMode ? {
                            width: `${widgetSize.width}px`,
                            height: widgetSize.height !== -1 ? `${widgetSize.height}px` : undefined,
                            maxHeight: widgetSize.height !== -1 ? 'none' : undefined,
                        } : {}),
                    }),
                }}
            >
                {/* Drag handle for teleprompter mode */}
                {isTeleprompterMode && (
                    <div 
                        className="drag-handle-teleprompter"
                        onMouseDown={() => {
                            // Basic drag implementation for the handle if needed
                            // For a full-screen teleprompter this might not even be necessary, 
                            // but we keep it just in case.
                        }}
                    />
                )}

                {/* Resize Handles (only visible when expanded and NOT teleprompter) */}
                {isExpanded && !isTeleprompterMode && (
                    <>
                        <div className="resize-handle resize-handle-left" onMouseDown={onResizeLeft} />
                        <div className="resize-handle resize-handle-bottom" onMouseDown={onResizeBottom} />
                        <div className="resize-handle resize-handle-bottom-left" onMouseDown={onResizeBottomLeft} />
                    </>
                )}
                {/* Header — always visible (unless teleprompter) */}
                {!isTeleprompterMode && (
                    <WidgetHeader
                        isRecording={isRecording}
                        isExpanded={isExpanded}
                        isCapturing={isCapturing}
                        isGenerating={isGenerating}
                        sessionTime={sessionTime}
                        hasTranscript={conversation && conversation.length > 0}
                        onToggleRecording={onToggleRecording}
                        onToggleExpanded={onToggleExpanded}
                        onCaptureScreen={onCaptureScreen}
                        onGenerateAnswer={onGenerateAnswer}
                        onToggleChat={onToggleChat}
                        onToggleHistory={onToggleHistory}
                        onTogglePractice={onTogglePractice}
                        onDrag={handleDrag}
                        onClose={onClose}
                    />
                )}

                {/* Expandable content */}
                <div className="widget-body">
                    {isTeleprompterMode ? (
                        <TeleprompterView candidateQuestions={candidateQuestions} />
                    ) : isFullPagePanel ? (
                        <div className="flex flex-col flex-1 h-full w-full overflow-hidden">
                            {isChatOpen ? (
                                <ChatPanel onClose={onToggleChat} />
                            ) : isHistoryOpen ? (
                                selectedSession ? (
                                    <SessionDetail 
                                        session={selectedSession} 
                                        onClose={onToggleHistory} 
                                        onBack={() => setSelectedSession(null)} 
                                    />
                                ) : (
                                    <SessionHistory 
                                        onClose={onToggleHistory} 
                                        onLoadSession={handleLoadSession} 
                                    />
                                )
                            ) : isPracticeOpen ? (
                                <div className="flex-1 overflow-y-auto custom-scrollbar">
                                    <PracticeMode />
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <>
                            {/* Loading indicator */}
                            {isModelLoading && (
                                <div className="px-4 py-3 border-b border-[var(--border-subtle)] animate-slide-up">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)] animate-pulse" />
                                        <span className="text-xs text-[var(--text-secondary)]">Loading STT model...</span>
                                    </div>
                                </div>
                            )}

                            {/* Error display */}
                            {modelError && (
                                <div className="px-4 py-3 border-b border-[var(--border-subtle)] animate-slide-up">
                                    <div className="px-3 py-2 rounded-lg bg-[var(--accent-red-dim)] border border-[var(--accent-red)]/20">
                                        <p className="text-xs text-[var(--accent-red)]">{modelError}</p>
                                    </div>
                                </div>
                            )}

                            {/* ═══ Interviewer Live Transcript Bar ═══ */}
                            {isRecording && (
                                <div className="bg-zinc-900/60 px-4 py-2 border-b border-[var(--border-subtle)] flex items-center gap-2 select-text shrink-0 animate-slide-up">
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Interviewer:</span>
                                    </div>
                                    <div 
                                        ref={liveTranscriptRef}
                                        className="text-xs text-zinc-300 italic flex-1 overflow-x-auto select-text scrollbar-none"
                                        style={{ whiteSpace: 'nowrap', scrollbarWidth: 'none' }}
                                        title={(() => {
                                            const latest = [...conversation].reverse().find(b => b.speaker === 'interviewer');
                                            return latest?.text || "Silence (listening for interviewer...)";
                                        })()}
                                    >
                                        {(() => {
                                            const latest = [...conversation].reverse().find(b => b.speaker === 'interviewer');
                                            return latest?.text || "Silence (listening for interviewer...)";
                                        })()}
                                    </div>
                                </div>
                            )}

                            {/* ═══ Single Panel Layout ═══ */}
                            <div className="flex-1 min-h-[300px] overflow-hidden flex flex-col">
                                <AnswerSuggestions
                                    candidateQuestions={candidateQuestions}
                                    detectedQuestions={detectedQuestions}
                                    expandedQuestionId={expandedQuestionId}
                                    onPickQuestion={onPickQuestion}
                                    onDismissCandidate={onDismissCandidate}
                                    onSelectOption={onSelectOption}
                                    onClearAll={handleClearAll}
                                />
                            </div>

                            {/* ═══ Bottom Bar ═══ */}
                            <div className="widget-bottom-bar">
                                <div className="privacy-badge">
                                    <Shield className="w-3 h-3" />
                                    <span>Privacy First (Local Only)</span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-zinc-400 font-medium">
                                        Auto Question Detection
                                    </span>
                                    <button
                                        onClick={onToggleAutoDetection}
                                        className={`toggle-switch ${autoDetectionEnabled ? 'toggle-switch--active' : ''}`}
                                        title="Toggle auto question detection"
                                    >
                                        <div className="toggle-switch__knob" />
                                    </button>
                                </div>
                            </div>

                            {/* Delivery Metrics Bar */}
                            <MetricsBar 
                                conversation={conversation} 
                                sessionTime={sessionTime} 
                                isRecording={isRecording} 
                            />
                        </>
                    )}
                </div>
            </div>
            {safeCursorMode && isHovered && (
                <div
                    className={`custom-html-cursor custom-html-cursor--${cursorType}`}
                    style={{
                        left: `${mousePos.x}px`,
                        top: `${mousePos.y}px`,
                    }}
                />
            )}
        </div>
    );
}

export type { Answer } from '../../state';
