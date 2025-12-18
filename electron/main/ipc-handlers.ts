import { ipcMain, app } from 'electron';
import { getTranscriber } from './whisper/transcriber';
import { IPC_CHANNELS } from '../types/ipc';
import { BrowserWindow } from 'electron';

export function registerIPCHandlers(): void {

    // Load Whisper model
    ipcMain.handle(IPC_CHANNELS.WHISPER_LOAD_MODEL, async (event, modelName: string) => {
        try {
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
            const transcriber = getTranscriber();

            // Convert number array back to Float32Array
            const float32Audio = new Float32Array(audioData);

            const text = await transcriber.transcribe(float32Audio);

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

    // // Window: Set ignore mouse events (for click-through behavior)
    ipcMain.handle(IPC_CHANNELS.SET_IGNORE_MOUSE_EVENTS, async (event, ignore: boolean) => {
        try {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                // When ignore is true, mouse events pass through transparent areas
                // The 'forward' option allows mouse events to be forwarded to elements beneath
                window.setIgnoreMouseEvents(ignore, { forward: true });
                return { success: true };
            }
            return { success: false, error: 'No window found' };
        } catch (error) {
            console.error('IPC: Failed to set ignore mouse events:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Window: Move window by delta (for custom drag implementation)
    ipcMain.handle(IPC_CHANNELS.MOVE_WINDOW, async (event, deltaX: number, deltaY: number) => {
        try {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                const [currentX, currentY] = window.getPosition();
                window.setPosition(currentX + deltaX, currentY + deltaY);
                return { success: true };
            }
            return { success: false, error: 'No window found' };
        } catch (error) {
            console.error('IPC: Failed to move window:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Screen: Capture screenshot
    ipcMain.handle(IPC_CHANNELS.CAPTURE_SCREEN, async (event, sourceId?: string) => {
        try {
            const { captureScreen } = await import('./screen-capture');
            const imageData = await captureScreen(sourceId);

            return {
                success: true,
                imageData,
            };
        } catch (error) {
            console.error('IPC: Screen capture failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Screen: Analyze screenshot with LLM vision
    ipcMain.handle(IPC_CHANNELS.ANALYZE_SCREEN, async (event, params: {
        imageData: string;
        prompt?: string;
        context?: string;
    }) => {
        try {
            const { getLLMService } = await import('./llm/llm-service');
            const llmService = getLLMService();

            // Build vision prompt
            const systemPrompt = `You are an expert interview assistant analyzing a screenshot. 
Extract relevant information from the image and provide a professional, concise answer.
Focus on:
- Text content (questions, code, problems)
- Visual elements (diagrams, charts, UI)
- Context and meaning

Be clear, structured, and helpful.`;

            const userPrompt = params.prompt ||
                `Analyze this screenshot from an interview. Extract any questions, problems, or important information, and provide a professional answer or explanation.`;

            const fullPrompt = params.context
                ? `${userPrompt}\n\nAdditional Context:\n${params.context}`
                : userPrompt;

            // Generate answer with vision
            const result = await llmService.generate({
                systemPrompt,
                prompt: fullPrompt,
                imageData: params.imageData,
                temperature: 0.7,
                maxTokens: 1024,
                stream: false,
            });

            return {
                success: true,
                answer: result.text,
            };
        } catch (error) {
            console.error('IPC: Screen analysis failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Window: Resize window (for modals and overlays)
    ipcMain.handle(IPC_CHANNELS.RESIZE_WINDOW, async (event, width: number, height: number) => {
        try {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                const { screen } = await import('electron');
                const primaryDisplay = screen.getPrimaryDisplay();
                const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

                // Calculate centered position for the new size
                const newX = Math.round((screenWidth - width) / 2);
                const newY = Math.round((screenHeight - height) / 2);

                // Set both size and position
                window.setBounds({
                    x: newX,
                    y: Math.max(16, newY), // Keep at least 16px from top
                    width: width,
                    height: height,
                });

                return { success: true };
            }
            return { success: false, error: 'No window found' };
        } catch (error) {
            console.error('IPC: Failed to resize window:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // App: Quit application
    ipcMain.handle(IPC_CHANNELS.QUIT_APP, async () => {
        try {
            app.quit();
            return { success: true };
        } catch (error) {
            console.error('IPC: Failed to quit app:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

}
