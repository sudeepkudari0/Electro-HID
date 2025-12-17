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

// IPC Channel names
export const IPC_CHANNELS = {
    WHISPER_LOAD_MODEL: 'whisper:load-model',
    WHISPER_TRANSCRIBE: 'whisper:transcribe',
    WHISPER_STATUS: 'whisper:status',
    WHISPER_PROGRESS: 'whisper:progress',
    GET_DESKTOP_SOURCES: 'get-desktop-sources',
    SET_IGNORE_MOUSE_EVENTS: 'window:set-ignore-mouse-events',
} as const;
