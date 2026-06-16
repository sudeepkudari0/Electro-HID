// Shared type definitions for IPC communication between main and renderer processes

export interface WhisperLoadModelParams {
    modelName: string;
}

export interface WhisperTranscribeParams {
    audioData: Float32Array;
    prompt?: string;
}

export interface WhisperTranscribeResult {
    text: string;
    words?: { word: string; start: number; end: number }[];
    success: boolean;
    error?: string;
}

export interface WhisperProgressEvent {
    stage: 'downloading' | 'loading' | 'ready';
    progress: number;
}

export interface WhisperModelStatus {
    isLoaded: boolean;
    modelName?: string;
    error?: string;
}

// Screen capture types
export interface CaptureScreenParams {
    sourceId?: string; // Optional: specific window/screen to capture
}

export interface CaptureScreenResult {
    success: boolean;
    imageData?: string; // Base64 encoded image
    error?: string;
}

export interface AnalyzeScreenParams {
    imageData: string; // Base64 encoded image
    prompt?: string; // Optional custom prompt
    context?: string; // Additional context (resume, JD, etc.)
}

export interface AnalyzeScreenResult {
    success: boolean;
    answer?: string;
    extractedText?: string; // Optional: text extracted from image
    error?: string;
}

// IPC Channel names
export const IPC_CHANNELS = {
    WHISPER_LOAD_MODEL: 'whisper:load-model',
    WHISPER_TRANSCRIBE: 'whisper:transcribe',
    WHISPER_STATUS: 'whisper:status',
    WHISPER_PROGRESS: 'whisper:progress',
    GET_DESKTOP_SOURCES: 'get-desktop-sources',
    SET_IGNORE_MOUSE_EVENTS: 'window:set-ignore-mouse-events',
    MOVE_WINDOW: 'window:move',
    CAPTURE_SCREEN: 'screen:capture',
    ANALYZE_SCREEN: 'screen:analyze',
    CAPTURE_AND_ANALYZE: 'screen:capture-and-analyze',
    GET_SETTINGS: 'settings:get',
    UPDATE_SETTINGS: 'settings:update',
    CHECK_STT_SERVER: 'server:check-stt',
    GET_AVAILABLE_MODELS: 'models:get-available',
    TEST_OLLAMA: 'ollama:test',
    TEST_OPENAI: 'openai:test',
    QUIT_APP: 'app:quit',
    DOWNLOAD_WHISPER_MODEL: 'whisper:download-model',
    DOWNLOAD_MOONSHINE_MODEL: 'moonshine:download-model',
    // Session & Profile Storage
    SESSION_SAVE: 'session:save',
    SESSION_LOAD: 'session:load',
    SESSION_LIST: 'session:list',
    SESSION_DELETE: 'session:delete',
    PROFILE_SAVE: 'profile:save',
    PROFILE_LOAD: 'profile:load',
    // Career Hub
    CAREER_JOBS_SAVE: 'career:jobs:save',
    CAREER_JOBS_LOAD: 'career:jobs:load',
    CAREER_PROFILE_SAVE: 'career:profile:save',
    CAREER_PROFILE_LOAD: 'career:profile:load',
    CAREER_RUN_JOBSPY: 'career:run-jobspy',
    CAREER_RUN_APPLY: 'career:run-apply',
    CAREER_STOP_APPLY: 'career:stop-apply',
    CAREER_RUN_LOGIN: 'career:run-login',
    CAREER_STOP_LOGIN: 'career:stop-login',
    // Window management
    SWITCH_TO_INTERVIEW: 'window:switch-interview',
    SWITCH_TO_DASHBOARD: 'window:switch-dashboard',
    OPEN_EXTERNAL: 'shell:open-external',
} as const;
