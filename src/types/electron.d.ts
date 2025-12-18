// Global type declarations for renderer process

interface WhisperAPI {
    loadModel: (modelName?: string) => Promise<{ success: boolean; error?: string }>;
    transcribe: (audioData: Float32Array) => Promise<{
        success: boolean;
        text: string;
        error?: string;
    }>;
    getStatus: () => Promise<{
        success: boolean;
        isLoaded: boolean;
        modelPath?: string;
        error?: string;
    }>;
}

interface DesktopSource {
    id: string;
    name: string;
    type: 'screen' | 'window';
}

interface ElectronAPI {
    platform: string;
    getDesktopSources: () => Promise<DesktopSource[]>;
    setIgnoreMouseEvents: (ignore: boolean) => Promise<{ success: boolean; error?: string }>;
    moveWindow: (deltaX: number, deltaY: number) => Promise<{ success: boolean; error?: string }>;
    whisper: WhisperAPI;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };
