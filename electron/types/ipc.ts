// Shared type definitions for IPC communication between main and renderer processes

export interface WhisperLoadModelParams {
    modelName: string;
}

export interface WhisperTranscribeParams {
    audioData: Float32Array;
}

export interface WhisperTranscribeResult {
    text: string;
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
    RESIZE_WINDOW: 'window:resize',
    QUIT_APP: 'app:quit',
} as const;
