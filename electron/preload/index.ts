import { contextBridge, ipcRenderer } from 'electron';

// Inline IPC channel names to avoid import issues
const IPC_CHANNELS = {
    WHISPER_LOAD_MODEL: 'whisper:load-model',
    WHISPER_TRANSCRIBE: 'whisper:transcribe',
    WHISPER_STATUS: 'whisper:status',
    GET_DESKTOP_SOURCES: 'get-desktop-sources',
    SET_IGNORE_MOUSE_EVENTS: 'window:set-ignore-mouse-events',
    MOVE_WINDOW: 'window:move',
    CAPTURE_SCREEN: 'screen:capture',
    ANALYZE_SCREEN: 'screen:analyze',
    CAPTURE_AND_ANALYZE: 'screen:capture-and-analyze',
    GET_SETTINGS: 'settings:get',
    UPDATE_SETTINGS: 'settings:update',
    GET_AVAILABLE_MODELS: 'models:get-available',
    TEST_OLLAMA: 'ollama:test',
    TEST_OPENAI: 'openai:test',
    QUIT_APP: 'app:quit',
    DOWNLOAD_WHISPER_MODEL: 'whisper:download-model',
    DOWNLOAD_MOONSHINE_MODEL: 'moonshine:download-model',
    SESSION_SAVE: 'session:save',
    SESSION_LOAD: 'session:load',
    SESSION_LIST: 'session:list',
    SESSION_DELETE: 'session:delete',
    PROFILE_SAVE: 'profile:save',
    PROFILE_LOAD: 'profile:load',
    CHECK_STT_SERVER: 'server:check-stt',
    HID_TYPE_TEXT: 'hid:type-text',
    HID_STOP_TYPING: 'hid:stop-typing',
    HID_MIRROR_START: 'hid:mirror-start',
    HID_MIRROR_STOP: 'hid:mirror-stop',
    HID_KEY_PRESSED: 'hid:key-pressed',
} as const;

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Platform info
    platform: process.platform,

    // Desktop capturer API
    getDesktopSources: async () => {
        return await ipcRenderer.invoke(IPC_CHANNELS.GET_DESKTOP_SOURCES);
    },

    // Window control API
    setIgnoreMouseEvents: async (ignore: boolean) => {
        return await ipcRenderer.invoke(IPC_CHANNELS.SET_IGNORE_MOUSE_EVENTS, ignore);
    },

    moveWindow: async (deltaX: number, deltaY: number) => {
        return await ipcRenderer.invoke(IPC_CHANNELS.MOVE_WINDOW, deltaX, deltaY);
    },

    setWindowSize: async (width: number, height: number) => {
        return await ipcRenderer.invoke('window:set-size', width, height);
    },

    // Whisper API
    whisper: {
        loadModel: async (modelName: string = 'small.en') => {
            return await ipcRenderer.invoke(IPC_CHANNELS.WHISPER_LOAD_MODEL, modelName);
        },

        transcribe: async (audioData: Float32Array, prompt?: string) => {
            // Convert Float32Array to regular array for IPC transfer
            const dataArray = Array.from(audioData);
            return await ipcRenderer.invoke(IPC_CHANNELS.WHISPER_TRANSCRIBE, { audioData: dataArray, prompt });
        },

        getStatus: async () => {
            return await ipcRenderer.invoke(IPC_CHANNELS.WHISPER_STATUS);
        },

        downloadModel: async (modelName: string, onProgress: (progress: number) => void) => {
            const progressHandler = (_event: any, data: { progress: number }) => onProgress(data.progress);
            ipcRenderer.on('whisper:download-progress', progressHandler);
            try {
                return await ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_WHISPER_MODEL, modelName);
            } finally {
                ipcRenderer.removeListener('whisper:download-progress', progressHandler);
            }
        },
    },

    // Screen API
    captureScreen: async (sourceId?: string) => {
        return await ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_SCREEN, sourceId);
    },

    analyzeScreen: async (imageData: string, prompt?: string, context?: string) => {
        return await ipcRenderer.invoke(IPC_CHANNELS.ANALYZE_SCREEN, {
            imageData,
            prompt,
            context,
        });
    },

    // One-shot capture + analyze (no UI needed)
    captureAndAnalyze: async (prompt?: string) => {
        return await ipcRenderer.invoke(IPC_CHANNELS.CAPTURE_AND_ANALYZE, prompt);
    },

    // LLM API
    llmGenerate: async (
        options: {
            systemPrompt: string;
            prompt: string;
            temperature?: number;
            maxTokens?: number;
            stream?: boolean;
            imageData?: string;
            format?: string;
            requestId?: string;
        },
        onChunk?: (chunk: string) => void
    ) => {
        if (onChunk) {
            const requestId = options.requestId || Math.random().toString(36).substring(7);
            const chunkHandler = (_event: any, data: { chunk: string }) => onChunk(data.chunk);
            const doneHandler = () => cleanup();
            const errorHandler = (_event: any, data: { error: string }) => {
                console.error('LLM Stream Error:', data.error);
                cleanup();
            };

            const cleanup = () => {
                ipcRenderer.removeListener(`llm:chunk:${requestId}`, chunkHandler);
                ipcRenderer.removeListener(`llm:done:${requestId}`, doneHandler);
                ipcRenderer.removeListener(`llm:error:${requestId}`, errorHandler);
            };

            ipcRenderer.on(`llm:chunk:${requestId}`, chunkHandler);
            ipcRenderer.once(`llm:done:${requestId}`, doneHandler);
            ipcRenderer.once(`llm:error:${requestId}`, errorHandler);

            return await ipcRenderer.invoke('llm:generate', { ...options, requestId });
        }
        return await ipcRenderer.invoke('llm:generate', options);
    },

    llmAbort: async (requestId: string) => {
        return await ipcRenderer.invoke('llm:abort', requestId);
    },

    nlpSetup: async () => {
        return await ipcRenderer.invoke('nlp:setup');
    },

    nlpStatus: async () => {
        return await ipcRenderer.invoke('nlp:status');
    },

    // App control API
    quitApp: async () => {
        return await ipcRenderer.invoke(IPC_CHANNELS.QUIT_APP);
    },

    // Settings API
    getSettings: async () => {
        return await ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS);
    },

    updateSettings: async (settings: any) => {
        return await ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SETTINGS, settings);
    },

    getAvailableModels: async () => {
        return await ipcRenderer.invoke(IPC_CHANNELS.GET_AVAILABLE_MODELS);
    },

    downloadMoonshineModel: async (modelName: string) => {
        return await ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_MOONSHINE_MODEL, modelName);
    },

    checkSttServer: async (engine: 'whisper' | 'moonshine') => {
        return await ipcRenderer.invoke(IPC_CHANNELS.CHECK_STT_SERVER, engine);
    },

    testOllama: async () => {
        return await ipcRenderer.invoke(IPC_CHANNELS.TEST_OLLAMA);
    },

    testOpenAI: async () => {
        return await ipcRenderer.invoke(IPC_CHANNELS.TEST_OPENAI);
    },

    llmGetAvailableModels: async (provider: 'gemini' | 'groq') => {
        return await ipcRenderer.invoke('llm:get-available-models', provider);
    },

    // TTS API
    tts: {
        synthesize: async (text: string) => {
            return await ipcRenderer.invoke('tts:synthesize', text);
        }
    },

    // Storage API
    session: {
        save: async (session: any) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_SAVE, session),
        load: async (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LOAD, id),
        list: async () => ipcRenderer.invoke(IPC_CHANNELS.SESSION_LIST),
        delete: async (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SESSION_DELETE, id),
    },

    profile: {
        save: async (profile: any) => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SAVE, profile),
        load: async () => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LOAD),
    },

    // Shortcut listeners — renderer subscribes to global shortcut events
    onShortcut: (channel: string, callback: (data?: any) => void) => {
        const validChannels = [
            'shortcut:capture-screen',
            'shortcut:generate-answer',
            'shortcut:toggle-widget',
            'shortcut:toggle-recording',
            'shortcut:toggle-chat',
            'shortcut:toggle-hide',
            'shortcut:toggle-teleprompter',
            'shortcut:opacity-up',
            'shortcut:opacity-down',
            'shortcut:toggle-mirroring',
        ];
        if (validChannels.includes(channel)) {
            const handler = (_event: any, data: any) => callback(data);
            ipcRenderer.on(channel, handler);
            return () => ipcRenderer.removeListener(channel, handler);
        }
        return () => { };
    },

    onSettingsUpdated: (callback: (settings: any) => void) => {
        const handler = (_event: any, settings: any) => callback(settings);
        ipcRenderer.on('settings:updated', handler);
        return () => {
            ipcRenderer.removeListener('settings:updated', handler);
        };
    },

    // Career Hub APIs
    careerHub: {
        saveJobs: async (jobs: any[]) => ipcRenderer.invoke('career:jobs:save', jobs),
        loadJobs: async () => ipcRenderer.invoke('career:jobs:load'),
        saveProfile: async (profile: any) => ipcRenderer.invoke('career:profile:save', profile),
        loadProfile: async () => ipcRenderer.invoke('career:profile:load'),
        runJobspy: async (options: any) => ipcRenderer.invoke('career:run-jobspy', options),
        checkJobspy: async () => ipcRenderer.invoke('career:check-jobspy'),
        onSetupStatus: (callback: (status: string) => void) => {
            const handler = (_event: any, status: string) => callback(status);
            ipcRenderer.on('career:jobspy-setup-status', handler);
            return () => ipcRenderer.removeListener('career:jobspy-setup-status', handler);
        },
        fetchUrl: async (url: string) => ipcRenderer.invoke('career:fetch-url', url),
        runApply: async (options: any) => ipcRenderer.invoke('career:run-apply', options),
        stopApply: async () => ipcRenderer.invoke('career:stop-apply'),
        approveApply: async () => ipcRenderer.invoke('career:approve-apply'),
        autofillPage: async (options: any) => ipcRenderer.invoke('career:autofill-page', options),
        runAutofillSession: async (options: any) => ipcRenderer.invoke('career:run-autofill-session', options),
        runLogin: async (site: 'linkedin' | 'default' | 'wellfound') => ipcRenderer.invoke('career:run-login', site),
        stopLogin: async () => ipcRenderer.invoke('career:stop-login'),
        checkLogin: async (site: 'linkedin' | 'default' | 'wellfound') => ipcRenderer.invoke('career:check-login', site),
        clearSession: async (site: 'linkedin' | 'default' | 'wellfound') => ipcRenderer.invoke('career:clear-session', site),
        onApplyStatus: (callback: (eventData: any) => void) => {
            const handler = (_event: any, data: any) => callback(data);
            ipcRenderer.on('career:apply-status', handler);
            return () => ipcRenderer.removeListener('career:apply-status', handler);
        },
        saveBlockedCompanies: async (companies: string[]) => ipcRenderer.invoke('career:blocked-companies:save', companies),
        loadBlockedCompanies: async () => ipcRenderer.invoke('career:blocked-companies:load'),
        runWellfoundApply: async (options: any) => ipcRenderer.invoke('career:run-wellfound-apply', options),
        stopWellfoundApply: async () => ipcRenderer.invoke('career:stop-wellfound-apply'),
    },

    // Shell API
    openExternal: async (url: string) => ipcRenderer.invoke('shell:open-external', url),

    // Window switching
    switchToInterview: async () => ipcRenderer.invoke('window:switch-interview'),
    switchToDashboard: async () => ipcRenderer.invoke('window:switch-dashboard'),

    // Window controls
    windowControl: {
        minimize: async () => ipcRenderer.invoke('window:minimize'),
        maximize: async () => ipcRenderer.invoke('window:maximize'),
        close: async () => ipcRenderer.invoke('window:close'),
        isMaximized: async () => ipcRenderer.invoke('window:is-maximized'),
        onStateChanged: (callback: (state: { isMaximized: boolean }) => void) => {
            const handler = (_event: any, data: { isMaximized: boolean }) => callback(data);
            ipcRenderer.on('window:state-changed', handler);
            return () => ipcRenderer.removeListener('window:state-changed', handler);
        }
    },

    // HID / Keyboard injection API
    hid: {
        typeText: async (text: string) => {
            return await ipcRenderer.invoke(IPC_CHANNELS.HID_TYPE_TEXT, text);
        },
        stopTyping: async () => {
            return await ipcRenderer.invoke(IPC_CHANNELS.HID_STOP_TYPING);
        },
        startMirroring: async () => {
            return await ipcRenderer.invoke(IPC_CHANNELS.HID_MIRROR_START);
        },
        stopMirroring: async () => {
            return await ipcRenderer.invoke(IPC_CHANNELS.HID_MIRROR_STOP);
        },
        onKeyPressed: (callback: (char: string) => void) => {
            const handler = (_event: any, char: string) => callback(char);
            ipcRenderer.on(IPC_CHANNELS.HID_KEY_PRESSED, handler);
            return () => ipcRenderer.removeListener(IPC_CHANNELS.HID_KEY_PRESSED, handler);
        }
    },

    // Deepgram Streaming STT API
    deepgram: {
        startStream: async () => {
            return await ipcRenderer.invoke('deepgram:start-stream');
        },
        startSystemSession: async () => {
            return await ipcRenderer.invoke('deepgram:start-system-session');
        },
        sendAudio: async (speaker: 'user' | 'interviewer', audioData: number[]) => {
            return await ipcRenderer.invoke('deepgram:send-audio', { speaker, audioData });
        },
        stopStream: async () => {
            return await ipcRenderer.invoke('deepgram:stop-stream');
        },
        onTranscript: (callback: (data: any) => void) => {
            const handler = (_event: any, data: any) => callback(data);
            ipcRenderer.on('deepgram:transcript', handler);
            return () => ipcRenderer.removeListener('deepgram:transcript', handler);
        },
        onUtteranceEnd: (callback: (data: { speaker: string }) => void) => {
            const handler = (_event: any, data: { speaker: string }) => callback(data);
            ipcRenderer.on('deepgram:utterance-end', handler);
            return () => ipcRenderer.removeListener('deepgram:utterance-end', handler);
        },
        onSpeechStarted: (callback: (data: { speaker: string }) => void) => {
            const handler = (_event: any, data: { speaker: string }) => callback(data);
            ipcRenderer.on('deepgram:speech-started', handler);
            return () => ipcRenderer.removeListener('deepgram:speech-started', handler);
        },
        onError: (callback: (data: { error: string }) => void) => {
            const handler = (_event: any, data: { error: string }) => callback(data);
            ipcRenderer.on('deepgram:error', handler);
            return () => ipcRenderer.removeListener('deepgram:error', handler);
        },
    },
});
