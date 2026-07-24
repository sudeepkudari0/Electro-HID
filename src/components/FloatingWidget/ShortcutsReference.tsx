import React from 'react';
import { X, Keyboard } from 'lucide-react';

interface ShortcutsReferenceProps {
    onClose: () => void;
}

const SHORTCUTS = [
    { category: 'Recording & Capture', items: [
        { keys: ['Ctrl', 'Shift', 'R'], action: 'Toggle Recording' },
        { keys: ['Ctrl', 'Shift', 'S'], action: 'Capture Full Screen' },
        { keys: ['Ctrl', 'Shift', 'G'], action: 'Generate Answer' },
    ]},
    { category: 'Navigation & View', items: [
        { keys: ['Ctrl', 'Shift', 'H'], action: 'Toggle Widget' },
        { keys: ['Ctrl', 'Shift', 'C'], action: 'Toggle Chat Panel' },
        { keys: ['Ctrl', 'Shift', 'X'], action: 'Hide/Show Widget' },
        { keys: ['Ctrl', 'Shift', '↑'], action: 'Increase Opacity' },
        { keys: ['Ctrl', 'Shift', '↓'], action: 'Decrease Opacity' },
        { keys: ['Esc'], action: 'Close Current Panel' },
    ]},
];

export const ShortcutsReference: React.FC<ShortcutsReferenceProps> = ({ onClose }) => {
    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-indigo-400" />
                    <h2 className="text-sm font-semibold text-white">Keyboard Shortcuts</h2>
                </div>
                <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-4 space-y-5">
                {SHORTCUTS.map(group => (
                    <div key={group.category}>
                        <h3 className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">
                            {group.category}
                        </h3>
                        <div className="space-y-1.5">
                            {group.items.map(({ keys, action }) => (
                                <div key={action} className="flex items-center justify-between text-xs">
                                    <span className="text-zinc-300">{action}</span>
                                    <div className="flex items-center gap-1">
                                        {keys.map((key, i) => (
                                            <React.Fragment key={i}>
                                                <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[10px] font-mono text-zinc-300 min-w-[24px] text-center">
                                                    {key}
                                                </kbd>
                                                {i < keys.length - 1 && <span className="text-zinc-600">+</span>}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}

                <div className="pt-2 border-t border-zinc-800">
                    <p className="text-[10px] text-zinc-500">
                        All shortcuts work globally while the app is running.
                    </p>
                </div>
            </div>
        </div>
    );
};
