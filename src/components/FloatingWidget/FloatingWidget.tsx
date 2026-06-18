import { useRef, useEffect, useState, useCallback } from 'react';
import { WidgetHeader } from './WidgetHeader';
import { TranscriptPanel } from './TranscriptPanel';
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
    onRegionCapture: () => void;
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
    onRegionCapture,
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
    const prevCandidateCount = useRef(candidateQuestions.length);
    const [selectedSession, setSelectedSession] = useState<any>(null);

    // ─── Widget CSS position (for drag) ───
    const [widgetPos, setWidgetPos] = useState({ top: 16, right: 16 });

    const handleDrag = useCallback((deltaX: number, deltaY: number) => {
        setWidgetPos(prev => ({
            top: Math.max(0, prev.top + deltaY),
            right: Math.max(0, prev.right - deltaX),
        }));
    }, []);

    // ─── Widget Size (for resize) ───
    const [widgetSize, setWidgetSize] = useState({ width: 860, height: -1 });

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

    // ─── Click-through management ───
    useEffect(() => {
        const el = widgetRef.current;
        if (!el) return;

        const handleEnter = () => {
            if (!isTeleprompterMode) {
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
    }, [isTeleprompterMode]);

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
        <div className="fixed top-0 right-0 w-full h-full pointer-events-none select-none z-50">
            <div
                ref={widgetRef}
                className={`widget pointer-events-auto ${isExpanded ? 'widget--expanded' : 'widget--collapsed'} ${isTeleprompterMode ? 'widget--teleprompter' : ''}`}
                id="floating-widget"
                style={{ 
                    top: isTeleprompterMode ? 0 : `${widgetPos.top}px`, 
                    right: isTeleprompterMode ? 0 : `${widgetPos.right}px`,
                    ...(isExpanded && !isTeleprompterMode ? {
                        width: `${widgetSize.width}px`,
                        height: widgetSize.height !== -1 ? `${widgetSize.height}px` : undefined,
                        maxHeight: widgetSize.height !== -1 ? 'none' : undefined,
                    } : {})
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
                        onRegionCapture={onRegionCapture}
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

                            {/* ═══ Split Panel Layout ═══ */}
                            <div className="split-layout">
                                {/* Left: Transcript */}
                                <div className="split-layout__left">
                                    <TranscriptPanel
                                        conversation={conversation}
                                        onClear={onClearTranscript}
                                        isRecording={isRecording}
                                        sttEngine={sttEngine}
                                        sttModel={sttModel}
                                        audioLevels={audioLevels}
                                    />
                                </div>

                                {/* Right: Answer Suggestions */}
                                <div className="split-layout__right">
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
                            </div>

                            {/* ═══ Bottom Bar ═══ */}
                            <div className="widget-bottom-bar">
                                <div className="privacy-badge">
                                    <Shield className="w-3 h-3" />
                                    <span>Privacy First (Local Only)</span>
                                </div>

                                <div className="flex items-center gap-2">
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
        </div>
    );
}

export type { Answer } from '../../state';
