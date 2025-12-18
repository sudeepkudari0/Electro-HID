import { useState } from 'react';
import { Mic, MicOff, Bell, Sparkles, Monitor, MessageSquare, MoreVertical, Plus, ChevronUp } from 'lucide-react';
import { OVERLAY_WIDTH, OVERLAY_HEIGHT } from '../../constants/overlay-dimensions';

interface HeaderOverlayProps {
    isRecording: boolean;
    onToggleRecording: () => void;
    onAIHelp: () => void;
    onAnalyzeScreen: () => void;
    onOpenChat: () => void;
    sessionTime: number; // in seconds
}

export function HeaderOverlay({
    isRecording,
    onToggleRecording,
    onAIHelp,
    onAnalyzeScreen,
    onOpenChat,
    sessionTime,
}: HeaderOverlayProps) {
    const [hasNotification, setHasNotification] = useState(true);

    // Format time as MM:SS
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div
            className="fixed top-0 left-0 z-50 select-none pointer-events-none"
            style={{
                width: `${OVERLAY_WIDTH}px`,
                height: `${OVERLAY_HEIGHT}px`,
            }}
        >
            {/* 
                Using -webkit-app-region: drag for native window dragging.
                This is the recommended approach for Electron frameless windows.
                It's smoother and more consistent than JS-based mouse tracking.
            */}
            <div
                className="bg-black/30 backdrop-blur-xl rounded-full px-4 py-2 flex items-center gap-3 shadow-2xl border border-white/20 pointer-events-auto"
                style={{
                    WebkitAppRegion: 'drag',
                    cursor: 'grab',
                } as React.CSSProperties}
            >
                {/* Logo & Brand - draggable area */}
                <div className="flex items-center gap-2 pr-3 border-r border-white/10">
                    <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-green-600 rounded-lg flex items-center justify-center">
                        <span className="text-white text-lg font-bold">E</span>
                    </div>
                    <span className="text-white font-semibold text-sm">ElectroHID</span>
                </div>

                {/* Notification Bell - non-draggable (clickable) */}
                <button
                    onClick={() => setHasNotification(false)}
                    className="relative p-2 hover:bg-white/10 rounded-full transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="Notifications"
                >
                    <Bell className="w-4 h-4 text-white" />
                    {hasNotification && (
                        <div className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full" />
                    )}
                </button>

                {/* Microphone Toggle - non-draggable (clickable) */}
                <button
                    onClick={onToggleRecording}
                    className={`p-2 rounded-full transition-colors ${isRecording ? 'bg-red-500/20 hover:bg-red-500/30' : 'hover:bg-white/10'
                        }`}
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title={isRecording ? 'Stop Recording' : 'Start Recording'}
                >
                    {isRecording ? (
                        <Mic className="w-4 h-4 text-red-400" />
                    ) : (
                        <MicOff className="w-4 h-4 text-white" />
                    )}
                </button>

                {/* AI Help Button - non-draggable (clickable) */}
                <button
                    onClick={onAIHelp}
                    className="flex flex-row items-center gap-2 px-4 py-1.5 bg-[#3A3A3A] hover:bg-[#4A4A4A] rounded-full transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="AI Help"
                >
                    <Sparkles className="w-4 h-4 text-white" />
                    <span className="text-white text-xs text-nowrap font-medium">AI Help</span>
                </button>

                {/* Analyze Screen Button - non-draggable (clickable) */}
                <button
                    onClick={onAnalyzeScreen}
                    className="flex flex-row items-center gap-2 px-4 py-1.5 bg-[#3A3A3A] hover:bg-[#4A4A4A] rounded-full transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="Analyze Screen"
                >
                    <Monitor className="w-4 h-4 text-white" />
                    <span className="text-white text-xs text-nowrap font-medium">Analyze Screen</span>
                </button>

                {/* Chat Button - non-draggable (clickable) */}
                <button
                    onClick={onOpenChat}
                    className="flex flex-row items-center gap-2 px-4 py-1.5 bg-[#3A3A3A] hover:bg-[#4A4A4A] rounded-full transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="Chat"
                >
                    <MessageSquare className="w-4 h-4 text-white" />
                    <span className="text-white text-xs text-nowrap font-medium">Chat</span>
                </button>

                {/* Timer - draggable area (not a button) */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#3A3A3A] rounded-full">
                    <div className="w-4 h-4 bg-white rounded-sm" />
                    <span className="text-white text-xs text-nowrap font-mono font-medium">
                        {formatTime(sessionTime)}
                    </span>
                </div>

                {/* More Options - non-draggable (clickable) */}
                <button
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="More Options"
                >
                    <MoreVertical className="w-4 h-4 text-white" />
                </button>

                {/* Add New - non-draggable (clickable) */}
                <button
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="Add New"
                >
                    <Plus className="w-4 h-4 text-white" />
                </button>

                {/* Minimize - non-draggable (clickable) */}
                <button
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    title="Minimize"
                >
                    <ChevronUp className="w-4 h-4 text-white" />
                </button>
            </div>
        </div>
    );
}
