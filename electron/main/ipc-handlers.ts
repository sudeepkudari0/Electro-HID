import { ipcMain } from 'electron';
import { getTranscriber } from './whisper/transcriber';
import { IPC_CHANNELS } from '../types/ipc';

export function registerIPCHandlers(): void {
    console.log('Registering IPC handlers...');

    // Load Whisper model
    ipcMain.handle(IPC_CHANNELS.WHISPER_LOAD_MODEL, async (event, modelName: string) => {
        try {
            console.log(`IPC: Loading model ${modelName}`);
            const transcriber = getTranscriber();
            await transcriber.initialize(modelName);
            return { success: true };
        } catch (error) {
            console.error('IPC: Failed to load model:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Transcribe audio
    ipcMain.handle(IPC_CHANNELS.WHISPER_TRANSCRIBE, async (event, audioData: number[]) => {
        try {
            console.log(`IPC: Transcribing audio (${audioData.length} samples)`);
            const transcriber = getTranscriber();

            // Convert number array back to Float32Array
            const float32Audio = new Float32Array(audioData);

            const text = await transcriber.transcribe(float32Audio);
            console.log('IPC: Transcription result:', JSON.stringify(text));
            console.log('IPC: Text length:', text.length);

            return {
                success: true,
                text: text.trim(),
            };
        } catch (error) {
            console.error('IPC: Transcription failed:', error);
            return {
                success: false,
                text: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Get model status
    ipcMain.handle(IPC_CHANNELS.WHISPER_STATUS, async () => {
        try {
            const transcriber = getTranscriber();
            const status = transcriber.getStatus();
            return {
                success: true,
                ...status,
            };
        } catch (error) {
            return {
                success: false,
                isLoaded: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Get desktop audio sources
    ipcMain.handle(IPC_CHANNELS.GET_DESKTOP_SOURCES, async () => {
        try {
            const { desktopCapturer } = await import('electron');
            const sources = await desktopCapturer.getSources({
                types: ['screen', 'window'],
                fetchWindowIcons: false,
            });

            // Return audio-capable sources
            return sources.map(source => ({
                id: source.id,
                name: source.name,
                type: source.id.startsWith('screen') ? 'screen' : 'window',
            }));
        } catch (error) {
            console.error('Failed to get desktop sources:', error);
            return [];
        }
    });

    // LLM: Generate response
    ipcMain.handle('llm:generate', async (event, options: {
        systemPrompt: string;
        prompt: string;
        temperature?: number;
        maxTokens?: number;
        stream?: boolean;
    }) => {
        try {
            console.log('IPC: Generating LLM response');
            const { getLLMService } = await import('./llm/llm-service');
            const llmService = getLLMService();

            const result = await llmService.generate(options);
            return {
                success: true,
                ...result,
            };
        } catch (error) {
            console.error('IPC: LLM generation failed:', error);
            return {
                success: false,
                text: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    console.log('IPC handlers registered successfully');
}
