import { contextBridge, ipcRenderer } from 'electron';

// Inline IPC channel names to avoid import issues
const IPC_CHANNELS = {
    WHISPER_LOAD_MODEL: 'whisper:load-model',
    WHISPER_TRANSCRIBE: 'whisper:transcribe',
    WHISPER_STATUS: 'whisper:status',
    GET_DESKTOP_SOURCES: 'get-desktop-sources',
} as const;

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Platform info
    platform: process.platform,

    // Desktop capturer API
    getDesktopSources: async () => {
        console.log('[Preload] getDesktopSources called');
        return await ipcRenderer.invoke(IPC_CHANNELS.GET_DESKTOP_SOURCES);
    },

    // Whisper API
    whisper: {
        loadModel: async (modelName: string = 'tiny.en') => {
            console.log('[Preload] loadModel called with:', modelName);
            return await ipcRenderer.invoke(IPC_CHANNELS.WHISPER_LOAD_MODEL, modelName);
        },

        transcribe: async (audioData: Float32Array) => {
            console.log('[Preload] transcribe called with audio length:', audioData.length);
            // Convert Float32Array to regular array for IPC transfer
            const dataArray = Array.from(audioData);
            return await ipcRenderer.invoke(IPC_CHANNELS.WHISPER_TRANSCRIBE, dataArray);
        },

        getStatus: async () => {
            console.log('[Preload] getStatus called');
            return await ipcRenderer.invoke(IPC_CHANNELS.WHISPER_STATUS);
        },
    },
});

console.log('[Preload] Script loaded successfully');
console.log('[Preload] electronAPI exposed with whisper methods');


