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
    resizeWindow: (width: number, height: number) => Promise<{ success: boolean; error?: string }>;
    whisper: WhisperAPI;
    captureScreen: (sourceId?: string) => Promise<{ success: boolean; imageData?: string; error?: string }>;
    analyzeScreen: (imageData: string, prompt?: string, context?: string) => Promise<{
        success: boolean;
        answer?: string;
        extractedText?: string;
        error?: string;
    }>;
    quitApp: () => Promise<{ success: boolean; error?: string }>;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

export { };
