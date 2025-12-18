import { useState, useEffect } from 'react';
import { X, Loader2, Camera, Sparkles, Monitor } from 'lucide-react';
import { OVERLAY_WIDTH, OVERLAY_HEIGHT } from '../../constants/overlay-dimensions';

interface AnalyzeScreenModalProps {
    onClose: () => void;
    onAnalyze: (answer: string) => void;
}

interface DesktopSource {
    id: string;
    name: string;
    type: 'screen' | 'window';
}

// Modal dimensions - expand to show full modal
const MODAL_WIDTH = 800;
const MODAL_HEIGHT = 300;

export function AnalyzeScreenModal({ onClose, onAnalyze }: AnalyzeScreenModalProps) {
    const [isCapturing, setIsCapturing] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [customPrompt, setCustomPrompt] = useState('');
    const [sources, setSources] = useState<DesktopSource[]>([]);
    const [selectedSource, setSelectedSource] = useState<string>('');

    // Resize window when modal opens/closes
    useEffect(() => {
        // Expand window to show modal
        window.electronAPI?.resizeWindow(MODAL_WIDTH, MODAL_HEIGHT).catch(console.error);

        // Restore window size when modal closes
        return () => {
            window.electronAPI?.resizeWindow(OVERLAY_WIDTH, OVERLAY_HEIGHT).catch(console.error);
        };
    }, []);

    // Load available screen sources
    useEffect(() => {
        const loadSources = async () => {
            try {
                const availableSources = await window.electronAPI.getDesktopSources();
                setSources(availableSources);
                // Auto-select first screen source
                const firstScreen = availableSources.find(s => s.type === 'screen');
                if (firstScreen) {
                    setSelectedSource(firstScreen.id);
                }
            } catch (err) {
                console.error('Failed to load sources:', err);
            }
        };
        loadSources();
    }, []);

    // Step 1: Capture screenshot
    const handleCapture = async () => {
        setIsCapturing(true);
        setError(null);

        try {
            console.log('Capturing screen with source:', selectedSource);
            const result = await window.electronAPI.captureScreen(selectedSource || undefined);
            console.log('Capture result:', { success: result.success, hasImage: !!result.imageData, error: result.error });

            if (result.success && result.imageData) {
                setCapturedImage(result.imageData);
            } else {
                setError(result.error || 'Failed to capture screen');
            }
        } catch (err) {
            console.error('Capture error:', err);
            setError(err instanceof Error ? err.message : 'Failed to capture screen');
        } finally {
            setIsCapturing(false);
        }
    };

    // Step 2: Analyze screenshot
    const handleAnalyze = async () => {
        if (!capturedImage) return;

        setIsAnalyzing(true);
        setError(null);

        try {
            console.log('Analyzing screen...');
            const result = await window.electronAPI.analyzeScreen(
                capturedImage,
                customPrompt || undefined
            );
            console.log('Analysis result:', { success: result.success, hasAnswer: !!result.answer, error: result.error });

            if (result.success && result.answer) {
                onAnalyze(result.answer);
                onClose();
            } else {
                setError(result.error || 'Failed to analyze screen');
            }
        } catch (err) {
            console.error('Analysis error:', err);
            setError(err instanceof Error ? err.message : 'Failed to analyze screen');
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Handle backdrop click
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ pointerEvents: 'auto' }}
            onClick={handleBackdropClick}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

            {/* Modal - Smaller and more compact */}
            <div
                className="relative w-full max-w-2xl bg-[#1A1A1A] rounded-xl shadow-2xl border border-white/20 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-gradient-to-r from-blue-500/10 to-purple-600/10">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg">
                            <Camera className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold text-white">Analyze Screen</h2>
                            <p className="text-xs text-gray-400">Capture & analyze with AI</p>
                        </div>
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                        type="button"
                    >
                        <X className="w-5 h-5 text-gray-400 hover:text-white" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
                    {/* Error Display */}
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <p className="text-red-400 text-sm">{error}</p>
                        </div>
                    )}

                    {/* Screen Source Selection */}
                    {!capturedImage && sources.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-300 flex items-center gap-1">
                                <Monitor className="w-3 h-3" />
                                <span>Select Screen/Window</span>
                            </label>
                            <select
                                value={selectedSource}
                                onChange={(e) => setSelectedSource(e.target.value)}
                                className="w-full px-3 py-2 bg-[#2A2A2A] border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                            >
                                {sources.map((source) => (
                                    <option key={source.id} value={source.id}>
                                        {source.type === 'screen' ? '🖥️' : '🪟'} {source.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Screenshot Preview */}
                    {capturedImage && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-300">Screenshot</label>
                            <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/40">
                                <img
                                    src={`data:image/png;base64,${capturedImage}`}
                                    alt="Captured screen"
                                    className="w-full h-auto max-h-72 object-contain"
                                />
                            </div>
                        </div>
                    )}

                    {/* Custom Prompt */}
                    {capturedImage && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-300">
                                Custom Instructions <span className="text-gray-500">(Optional)</span>
                            </label>
                            <textarea
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                placeholder="E.g., Focus on the coding problem, Explain the diagram..."
                                className="w-full px-3 py-2 bg-[#2A2A2A] border border-white/10 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                                rows={2}
                            />
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                        {!capturedImage ? (
                            <button
                                onClick={handleCapture}
                                disabled={isCapturing}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                type="button"
                            >
                                {isCapturing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Capturing...</span>
                                    </>
                                ) : (
                                    <>
                                        <Camera className="w-4 h-4" />
                                        <span>Capture Screen</span>
                                    </>
                                )}
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={() => {
                                        setCapturedImage(null);
                                        setCustomPrompt('');
                                        setError(null);
                                    }}
                                    className="flex-1 px-4 py-2.5 bg-[#2A2A2A] hover:bg-[#3A3A3A] text-white rounded-lg font-medium text-sm transition-colors border border-white/10"
                                    type="button"
                                >
                                    Recapture
                                </button>
                                <button
                                    onClick={handleAnalyze}
                                    disabled={isAnalyzing}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    type="button"
                                >
                                    {isAnalyzing ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            <span>Analyzing...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-4 h-4" />
                                            <span>Analyze with AI</span>
                                        </>
                                    )}
                                </button>
                            </>
                        )}
                    </div>

                    {/* Help Text */}
                    <p className="text-xs text-gray-500 text-center pt-1">
                        {!capturedImage
                            ? "Select a screen/window and capture to analyze with AI"
                            : "AI will read the image and provide a professional answer"
                        }
                    </p>
                </div>
            </div>
        </div>
    );
}
