// Electron IPC type definitions for renderer process

export interface IpcAPI {
    // Whisper.cpp transcription
    invoke(channel: 'whisper:load-model'): Promise<void>;
    invoke(channel: 'whisper:transcribe', data: Float32Array): Promise<string>;

    // Cloud LLM generation (OpenAI/Gemini)
    invoke(channel: 'llm:generate', options: {
        systemPrompt: string;
        prompt: string;
        temperature?: number;
        maxTokens?: number;
        stream?: boolean;
    }): Promise<{ text: string; stream?: AsyncIterable<string> }>;

    // Audio recording
    on(channel: 'audio:data', callback: (data: ArrayBuffer) => void): void;
    removeListener(channel: 'audio:data', callback: (data: ArrayBuffer) => void): void;

    // Generic invoke
    invoke(channel: string, ...args: any[]): Promise<any>;
}

declare global {
    interface Window {
        electron: IpcAPI;
    }
}

export { };
