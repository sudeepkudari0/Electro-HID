import { useState } from 'react';
import { Mic, MicOff, Bell, Sparkles, Monitor, MessageSquare, MoreVertical, Plus, ChevronUp } from 'lucide-react';

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
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 select-none">
            <div className="bg-black/30 backdrop-blur-xl rounded-full px-4 py-2 flex items-center gap-3 shadow-2xl border border-white/20">
                {/* Logo & Brand */}
                <div className="flex items-center gap-2 pr-3 border-r border-white/10">
                    <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-green-600 rounded-lg flex items-center justify-center">
                        <span className="text-white text-lg font-bold">E</span>
                    </div>
                    <span className="text-white font-semibold text-sm">ElectroHID</span>
                </div>

                {/* Notification Bell */}
                <button
                    onClick={() => setHasNotification(false)}
                    className="relative p-2 hover:bg-white/10 rounded-full transition-colors"
                    title="Notifications"
                >
                    <Bell className="w-4 h-4 text-white" />
                    {hasNotification && (
                        <div className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
                    )}
                </button>

                {/* Microphone Toggle */}
                <button
                    onClick={onToggleRecording}
                    className={`p-2 rounded-full transition-colors ${isRecording ? 'bg-red-500/20 hover:bg-red-500/30' : 'hover:bg-white/10'
                        }`}
                    title={isRecording ? 'Stop Recording' : 'Start Recording'}
                >
                    {isRecording ? (
                        <Mic className="w-4 h-4 text-red-400" />
                    ) : (
                        <MicOff className="w-4 h-4 text-white" />
                    )}
                </button>

                {/* AI Help Button */}
                <button
                    onClick={onAIHelp}
                    className="flex flex-row items-center gap-2 px-4 py-1.5 bg-[#3A3A3A] hover:bg-[#4A4A4A] rounded-full transition-colors"
                    title="AI Help"
                >
                    <Sparkles className="w-4 h-4 text-white" />
                    <span className="text-white text-sm font-medium">AI Help</span>
                </button>

                {/* Analyze Screen Button */}
                <button
                    onClick={onAnalyzeScreen}
                    className="flex flex-row items-center gap-2 px-4 py-1.5 bg-[#3A3A3A] hover:bg-[#4A4A4A] rounded-full transition-colors"
                    title="Analyze Screen"
                >
                    <Monitor className="w-4 h-4 text-white" />
                    <span className="text-white text-sm font-medium">Analyze Screen</span>
                </button>

                {/* Chat Button */}
                <button
                    onClick={onOpenChat}
                    className="flex flex-row items-center gap-2 px-4 py-1.5 bg-[#3A3A3A] hover:bg-[#4A4A4A] rounded-full transition-colors"
                    title="Chat"
                >
                    <MessageSquare className="w-4 h-4 text-white" />
                    <span className="text-white text-sm font-medium">Chat</span>
                </button>

                {/* Timer */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#3A3A3A] rounded-full">
                    <div className="w-4 h-4 bg-white rounded-sm" />
                    <span className="text-white text-sm font-mono font-medium">
                        {formatTime(sessionTime)}
                    </span>
                </div>

                {/* More Options */}
                <button
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    title="More Options"
                >
                    <MoreVertical className="w-4 h-4 text-white" />
                </button>

                {/* Add New */}
                <button
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    title="Add New"
                >
                    <Plus className="w-4 h-4 text-white" />
                </button>

                {/* Minimize */}
                <button
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    title="Minimize"
                >
                    <ChevronUp className="w-4 h-4 text-white" />
                </button>
            </div>
        </div>
    );
}
