import { create } from 'zustand';

interface UIState {
    // State
    isExpanded: boolean;
    isSettingsOpen: boolean;
    isChatOpen: boolean;
    isHistoryOpen: boolean;
    isPracticeOpen: boolean;
    isCapturing: boolean;
    isCodeMode: boolean;
    useBulletPoints: boolean;
    isTeleprompterMode: boolean;
    widgetOpacity: number;
    isDeveloperMode: boolean;
    safeCursorMode: boolean;

    // Actions
    toggleExpanded: () => void;
    setExpanded: (expanded: boolean) => void;
    toggleSettings: () => void;
    setSettingsOpen: (open: boolean) => void;
    toggleChat: () => void;
    setChatOpen: (open: boolean) => void;
    toggleHistory: () => void;
    setHistoryOpen: (open: boolean) => void;
    togglePractice: () => void;
    setPracticeOpen: (open: boolean) => void;
    setCapturing: (capturing: boolean) => void;
    toggleCodeMode: () => void;
    toggleBulletPoints: () => void;
    toggleTeleprompterMode: () => void;
    setWidgetOpacity: (opacity: number) => void;
    toggleDeveloperMode: () => void;
    setSafeCursorMode: (val: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
    // Initial state
    isExpanded: false,
    isSettingsOpen: false,
    isChatOpen: false,
    isHistoryOpen: false,
    isPracticeOpen: false,
    isCapturing: false,
    isCodeMode: false,
    useBulletPoints: false,
    isTeleprompterMode: false,
    widgetOpacity: 100,
    isDeveloperMode: false,
    safeCursorMode: true,

    // Actions
    toggleExpanded: () =>
        set((state) => {
            const willCollapse = state.isExpanded;
            return {
                isExpanded: !state.isExpanded,
                // Close settings, chat, history and practice when collapsing
                ...(willCollapse ? { isSettingsOpen: false, isChatOpen: false, isHistoryOpen: false, isPracticeOpen: false } : {}),
            };
        }),

    setExpanded: (expanded) => set({ isExpanded: expanded }),

    toggleSettings: () =>
        set((state) => {
            const willBeOpen = !state.isSettingsOpen;
            return {
                isSettingsOpen: willBeOpen,
                // Close others when opening settings, expand widget if needed
                ...(willBeOpen
                    ? { isChatOpen: false, isHistoryOpen: false, isPracticeOpen: false, isExpanded: true }
                    : {}),
            };
        }),

    setSettingsOpen: (open) => set({ isSettingsOpen: open }),

    toggleChat: () =>
        set((state) => {
            const willBeOpen = !state.isChatOpen;
            return {
                isChatOpen: willBeOpen,
                // Close others when opening chat, expand widget if needed
                ...(willBeOpen
                    ? { isSettingsOpen: false, isHistoryOpen: false, isPracticeOpen: false, isExpanded: true }
                    : {}),
            };
        }),

    setChatOpen: (open) => set({ isChatOpen: open }),

    toggleHistory: () =>
        set((state) => {
            const willBeOpen = !state.isHistoryOpen;
            return {
                isHistoryOpen: willBeOpen,
                // Close others when opening history, expand widget if needed
                ...(willBeOpen
                    ? { isSettingsOpen: false, isChatOpen: false, isPracticeOpen: false, isExpanded: true }
                    : {}),
            };
        }),

    setHistoryOpen: (open) => set({ isHistoryOpen: open }),

    togglePractice: () =>
        set((state) => {
            const willBeOpen = !state.isPracticeOpen;
            return {
                isPracticeOpen: willBeOpen,
                // Close others when opening practice, expand widget if needed
                ...(willBeOpen
                    ? { isSettingsOpen: false, isChatOpen: false, isHistoryOpen: false, isExpanded: true }
                    : {}),
            };
        }),

    setPracticeOpen: (open) => set({ isPracticeOpen: open }),

    setCapturing: (capturing) => set({ isCapturing: capturing }),

    toggleBulletPoints: () => set((state) => ({ useBulletPoints: !state.useBulletPoints })),

    toggleCodeMode: () => set((state) => ({ isCodeMode: !state.isCodeMode })),

    toggleTeleprompterMode: () => set((state) => ({ isTeleprompterMode: !state.isTeleprompterMode })),

    setWidgetOpacity: (opacity) => set({ widgetOpacity: opacity }),

    toggleDeveloperMode: () => set((state) => ({ isDeveloperMode: !state.isDeveloperMode })),

    setSafeCursorMode: (val) => set({ safeCursorMode: val }),
}));
