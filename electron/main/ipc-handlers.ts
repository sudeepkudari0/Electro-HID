import { ipcMain, app, globalShortcut, shell } from 'electron';
import { getTranscriber } from './whisper/transcriber';
import { IPC_CHANNELS } from '../types/ipc';
import { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { getNlpDir, getNlpVenvDir, getNlpVenvPython, findPythonExecutable, nlpServerManager } from './nlp/server-manager';

/**
 * Registers all IPC handlers in the Electron main process.
 * This establishes communication channels between the renderer process (frontend)
 * and the system/native features of the application, including:
 * - STT Engine (Whisper.cpp / Moonshine download and transcription)
 * - Screen capture and LLM analysis (Ollama / OpenAI APIs)
 * - App settings persistence and profile data data management
 * - Career Hub JobSpy scraper running and automatic resume tailoring
 * - Window controls and navigation routing
 */
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

    // Download Whisper model
    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_WHISPER_MODEL, async (event, modelName: string) => {
        return new Promise((resolve) => {
            const https = require('https');
            const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;
            const destDir = path.join(app.getPath('userData'), 'whisper-models');
            
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            
            const destPath = path.join(destDir, `ggml-${modelName}.bin`);
            const file = fs.createWriteStream(destPath);
            
            https.get(url, (response: any) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    // Handle redirect
                    https.get(response.headers.location, (redirectResponse: any) => {
                        handleDownload(redirectResponse);
                    }).on('error', handleError);
                } else {
                    handleDownload(response);
                }
                
                function handleDownload(res: any) {
                    if (res.statusCode !== 200) {
                        file.close();
                        fs.unlink(destPath, () => {}); // Delete temp file
                        resolve({ success: false, error: `Server returned ${res.statusCode}` });
                        return;
                    }
                    
                    const totalLen = parseInt(res.headers['content-length'] || '0', 10);
                    let downloaded = 0;
                    
                    res.on('data', (chunk: Buffer) => {
                        downloaded += chunk.length;
                        if (totalLen > 0) {
                            const percent = Math.round((downloaded / totalLen) * 100);
                            event.sender.send('whisper:download-progress', { progress: percent });
                        }
                    });
                    
                    res.pipe(file);
                    
                    file.on('finish', () => {
                        file.close();
                        resolve({ success: true });
                    });
                }
            }).on('error', handleError);
            
            function handleError(err: Error) {
                file.close();
                fs.unlink(destPath, () => {}); // Delete temp file
                resolve({ success: false, error: err.message });
            }
        });
    });

    // Download Moonshine model
    ipcMain.handle(IPC_CHANNELS.DOWNLOAD_MOONSHINE_MODEL, async (event, modelName: string) => {
        return new Promise((resolve) => {
            const exeName = 'moonshine-server.exe';
            let serverExePath: string;
            
            if (app.isPackaged) {
                serverExePath = path.join(process.resourcesPath, 'whisper', exeName);
            } else {
                serverExePath = path.join(app.getAppPath(), 'native', 'whisper', exeName);
            }
            
            if (!fs.existsSync(serverExePath)) {
                resolve({ success: false, error: 'Moonshine server executable not found. Please build it first.' });
                return;
            }

            const proc = spawn(serverExePath, [], {
                cwd: path.dirname(serverExePath),
                windowsHide: true,
                env: { ...process.env, MOONSHINE_DOWNLOAD_ONLY: modelName }
            });

            let errorOutput = '';

            proc.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true });
                } else {
                    resolve({ success: false, error: `Failed to download: ${errorOutput}` });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    });

    // Transcribe audio
    ipcMain.handle(IPC_CHANNELS.WHISPER_TRANSCRIBE, async (event, params: any) => {
        try {
            const transcriber = getTranscriber();

            // Handle both new format { audioData, prompt } and old format [number, number, ...]
            const audioDataArray = Array.isArray(params) ? params : params.audioData;
            const promptStr = Array.isArray(params) ? undefined : params.prompt;

            if (!audioDataArray) {
                throw new Error('No audio data provided');
            }

            // Convert number array back to Float32Array
            const float32Audio = new Float32Array(audioDataArray);

            const result = await transcriber.transcribe(float32Audio, promptStr);

            return {
                success: true,
                text: result.text.trim(),
                words: result.words,
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

    // Check if STT server exists
    ipcMain.handle(IPC_CHANNELS.CHECK_STT_SERVER, async (event, engine: 'whisper' | 'moonshine') => {
        const exeName = engine === 'whisper' ? 'whisper-server.exe' : 'moonshine-server.exe';
        let p;
        
        if (app.isPackaged) {
            p = path.join(process.resourcesPath, 'whisper', exeName);
        } else {
            p = path.join(app.getAppPath(), 'native', 'whisper', exeName);
        }
        
        return { exists: fs.existsSync(p) };
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

    // Active LLM requests for aborting
    const activeLlmRequests = new Map<string, AbortController>();

    ipcMain.handle('llm:abort', async (event: any, requestId: string) => {
        const controller = activeLlmRequests.get(requestId);
        if (controller) {
            controller.abort();
            activeLlmRequests.delete(requestId);
            return { success: true };
        }
        return { success: false, error: 'Request not found' };
    });

    ipcMain.handle('nlp:status', async () => {
        try {
            const { exec } = await import('child_process');
            const venvPy = getNlpVenvPython();
            const nlpDir = getNlpDir();

            if (!fs.existsSync(venvPy)) {
                return { installed: false };
            }

            const workDir = fs.existsSync(nlpDir) ? nlpDir : app.getPath('userData');

            return new Promise((resolve) => {
                exec(`"${venvPy}" -c "import spacy; spacy.load('en_core_web_sm')"`, { cwd: workDir }, (error) => {
                    if (error) {
                        resolve({ installed: false });
                    } else {
                        resolve({ installed: true });
                    }
                });
            });
        } catch (err: any) {
            return { installed: false, error: err.message };
        }
    });

    ipcMain.handle('nlp:setup', async () => {
        try {
            const { exec } = await import('child_process');
            const nlpDir = getNlpDir();
            const venvDir = getNlpVenvDir();
            const venvPy = getNlpVenvPython();

            if (!fs.existsSync(nlpDir)) {
                fs.mkdirSync(nlpDir, { recursive: true });
            }
            const venvParent = path.dirname(venvDir);
            if (!fs.existsSync(venvParent)) {
                fs.mkdirSync(venvParent, { recursive: true });
            }

            const pyCmd = findPythonExecutable() || (process.platform === 'win32' ? 'python' : 'python3');
            const workDir = fs.existsSync(nlpDir) ? nlpDir : app.getPath('userData');

            return new Promise((resolve) => {
                const createVenvCmd = `"${pyCmd}" -m venv "${venvDir}"`;

                exec(createVenvCmd, { cwd: workDir }, (venvErr, _stdout, venvStderr) => {
                    if (venvErr) {
                        console.error('NLP venv creation failed:', venvStderr || venvErr.message);
                        return resolve({ success: false, error: venvStderr || venvErr.message });
                    }

                    const installCmd = `"${venvPy}" -m pip install fastapi uvicorn click "spacy>=3.7.4" && "${venvPy}" -m spacy download en_core_web_sm`;
                    exec(installCmd, { cwd: workDir }, (installErr, installStdout, installStderr) => {
                        if (installErr) {
                            console.error('NLP Setup pip install failed:', installStderr || installErr.message);
                            resolve({ success: false, error: installStderr || installErr.message });
                        } else {
                            console.log('NLP Setup output:', installStdout);
                            nlpServerManager.ensureStarted().catch(console.error);
                            resolve({ success: true });
                        }
                    });
                });
            });
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    });

    // LLM: Generate response
    ipcMain.handle('llm:generate', async (event: any, options: {
        systemPrompt: string;
        prompt: string;
        temperature?: number;
        maxTokens?: number;
        stream?: boolean;
        imageData?: string;
        requestId?: string; // ID to tie stream chunks back to caller
    }) => {
        try {
            const { getLLMService } = await import('./llm/llm-service');
            const llmService = getLLMService();
            const requestId = options.requestId || 'default';
            
            const controller = new AbortController();
            activeLlmRequests.set(requestId, controller);
            
            const generateOptions = { ...options, signal: controller.signal };

            if (options.stream) {
                const result = await llmService.generate(generateOptions);
                
                if (result.stream) {
                    const stream = result.stream;
                    (async () => {
                        try {
                            for await (const chunk of stream) {
                                if (controller.signal.aborted) break;
                                event.sender.send(`llm:chunk:${requestId}`, { chunk });
                            }
                            if (!controller.signal.aborted) {
                                event.sender.send(`llm:done:${requestId}`);
                            }
                        } catch (error) {
                            if (controller.signal.aborted) return;
                            console.error('IPC: Streaming failed:', error);
                            event.sender.send(`llm:error:${requestId}`, { 
                                error: error instanceof Error ? error.message : 'Streaming failed' 
                            });
                        } finally {
                            activeLlmRequests.delete(requestId);
                        }
                    })();
                }
                
                return {
                    success: true,
                    streaming: true,
                };
            } else {
                try {
                    const result = await llmService.generate(generateOptions);
                    return {
                        success: true,
                        text: result.text,
                    };
                } finally {
                    activeLlmRequests.delete(requestId);
                }
            }
        } catch (error) {
            console.error('IPC: LLM generation failed:', error);
            return {
                success: false,
                text: '',
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // TTS: Synthesize speech via Deepgram Aura
    ipcMain.handle('tts:synthesize', async (event, text: string) => {
        try {
            const { getSettings } = await import('./settings');
            const settings = getSettings();
            if (!settings.deepgramApiKey) {
                throw new Error('Deepgram API Key is missing. Please set it in Settings.');
            }

            // Using asteria as default if not configured
            const model = settings.deepgramTtsModel || 'aura-asteria-en';
            
            const response = await fetch(`https://api.deepgram.com/v1/speak?model=${model}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${settings.deepgramApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Deepgram TTS failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            return {
                success: true,
                audio: Buffer.from(arrayBuffer)
            };
        } catch (error) {
            console.error('IPC: TTS generation failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    
    // Ollama: Test connection
    ipcMain.handle(IPC_CHANNELS.TEST_OLLAMA, async () => {
        try {
            const { LLMService } = await import('./llm/llm-service');
            const llmService = new LLMService({ llmProvider: 'ollama', useOllamaOnly: true });
            
            // Try a minimal generation to verify connectivity and model availability
            const result = await llmService.generate({
                systemPrompt: 'You are a connectivity tester.',
                prompt: 'Say "Ollama is active" in exactly three words.',
                maxTokens: 10,
                stream: false,
            });
            
            return { success: true, message: result.text.trim() };
        } catch (error) {
            console.error('IPC: Ollama test failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Ollama not reachable or model not found',
            };
        }
    });

    // OpenAI: Test connection
    ipcMain.handle(IPC_CHANNELS.TEST_OPENAI, async () => {
        try {
            const { LLMService } = await import('./llm/llm-service');
            const llmService = new LLMService({ llmProvider: 'openai' });
            
            // Try a minimal generation to verify connectivity and model availability
            const result = await llmService.generate({
                systemPrompt: 'You are a connectivity tester.',
                prompt: 'Say "OpenAI is active" in exactly three words.',
                maxTokens: 10,
                stream: false,
            });
            
            return { success: true, message: result.text.trim() };
        } catch (error) {
            console.error('IPC: OpenAI test failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'OpenAI not reachable or API key invalid',
            };
        }
    });

    // Fetch available Gemini, Groq & Mistral models
    ipcMain.handle('llm:get-available-models', async (event, provider: 'gemini' | 'groq' | 'mistral') => {
        try {
            const { getLLMService } = await import('./llm/llm-service');
            const llmService = getLLMService();
            const models = await llmService.listModels(provider);
            return { success: true, models };
        } catch (error) {
            console.error(`IPC: Failed to fetch ${provider} models:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    });

    // Window: Set ignore mouse events (for click-through behavior)
    // NOTE: The { forward: true } option is NOT supported on Linux.
    // On Linux, we skip click-through entirely so the overlay stays interactive.
    ipcMain.handle(IPC_CHANNELS.SET_IGNORE_MOUSE_EVENTS, async (event, ignore: boolean) => {
        try {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                if (process.platform === 'linux') {
                    // Linux: forward option not supported, so don't enable click-through.
                    // Always keep the window interactive.
                    if (!ignore) {
                        window.setIgnoreMouseEvents(false);
                    }
                    // When ignore=true, do nothing on Linux (no-op)
                } else {
                    if (ignore) {
                        // When ignoring, forward mouse events so renderer can detect mouseenter
                        window.setIgnoreMouseEvents(true, { forward: true });
                    } else {
                        // When NOT ignoring, accept all mouse events normally
                        window.setIgnoreMouseEvents(false);
                    }
                }
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

    // Window: Resize window (used on Linux to sync window to widget size)
    ipcMain.handle('window:set-size', async (event, width: number, height: number) => {
        try {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                window.setSize(Math.round(width), Math.round(height), false);
                return { success: true };
            }
            return { success: false, error: 'No window found' };
        } catch (error) {
            return { success: false, error: String(error) };
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

    // Screen: One-shot capture + analyze (no UI interaction needed)
    ipcMain.handle(IPC_CHANNELS.CAPTURE_AND_ANALYZE, async (event, prompt?: string) => {
        try {
            const { captureScreen } = await import('./screen-capture');
            const { getLLMService } = await import('./llm/llm-service');

            // Step 1: Capture primary screen
            const imageData = await captureScreen();

            // Step 2: Analyze with LLM vision
            const llmService = getLLMService();
            const systemPrompt = `You are an expert coding and interview assistant. Analyze the screenshot and provide a clear, structured response.
If you see code: explain it, identify bugs, suggest fixes, and provide the corrected version.
If you see a question: provide a professional, comprehensive answer.
If you see a DSA problem: explain the approach, provide the solution with time/space complexity.
Be concise but thorough. Use bullet points and code blocks where appropriate.`;

            const userPrompt = prompt ||
                'Analyze this screenshot. If it contains code, explain and debug it. If it contains a question or problem, provide a clear answer or solution.';

            const result = await llmService.generate({
                systemPrompt,
                prompt: userPrompt,
                imageData,
                temperature: 0.5,
                maxTokens: 2048,
                stream: false,
            });

            return {
                success: true,
                answer: result.text,
            };
        } catch (error) {
            console.error('IPC: Capture-and-analyze failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Settings
    ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
        try {
            const { getSettings } = await import('./settings');
            return { success: true, settings: getSettings() };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.UPDATE_SETTINGS, async (event, settings: any) => {
        try {
            const { saveSettings } = await import('./settings');
            const { resetLLMService } = await import('./llm/llm-service');
            const updated = saveSettings(settings);
            
            // Clear the old singleton to force re-reading new keys
            resetLLMService();
            
            return { success: true, settings: updated };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    // Get available models
    ipcMain.handle(IPC_CHANNELS.GET_AVAILABLE_MODELS, async () => {
        try {
            const dirs = [
                app.isPackaged 
                    ? path.join(process.resourcesPath, 'whisper', 'models')
                    : path.join(app.getAppPath(), 'native', 'whisper', 'models'),
                path.join(app.getPath('userData'), 'whisper-models')
            ];
            
            const allModels = new Set<string>();
            for (const dir of dirs) {
                if (fs.existsSync(dir)) {
                    const files = fs.readdirSync(dir);
                    files.filter((f: string) => f.startsWith('ggml-') && f.endsWith('.bin'))
                         .forEach((f: string) => allModels.add(f.replace('ggml-', '').replace('.bin', '')));
                }
            }
            
            return { success: true, models: Array.from(allModels) };
        } catch (error) {
            console.error('Failed to get available models:', error);
            return { success: false, models: [] };
        }
    });

    // Session Storage
    ipcMain.handle(IPC_CHANNELS.SESSION_SAVE, async (event, session: any) => {
        try {
            const { saveSession } = await import('./storage/session-store');
            saveSession(session);
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.SESSION_LOAD, async (event, id: string) => {
        try {
            const { loadSession } = await import('./storage/session-store');
            return { success: true, session: loadSession(id) };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.SESSION_LIST, async () => {
        try {
            const { listSessions } = await import('./storage/session-store');
            return { success: true, sessions: listSessions() };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.SESSION_DELETE, async (event, id: string) => {
        try {
            const { deleteSession } = await import('./storage/session-store');
            deleteSession(id);
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    // Profile Storage
    ipcMain.handle(IPC_CHANNELS.PROFILE_SAVE, async (event, profile: any) => {
        try {
            const { saveProfile } = await import('./storage/profile-store');
            saveProfile(profile);
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.PROFILE_LOAD, async () => {
        try {
            const { loadProfile } = await import('./storage/profile-store');
            return { success: true, profile: loadProfile() };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    // ── Career Hub: Job Storage ──────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.CAREER_JOBS_SAVE, async (event, jobs: any[]) => {
        try {
            const { JSONStore } = await import('./storage/store');
            const store = new JSONStore('career-hub');
            store.write('jobs.json', jobs);
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_JOBS_LOAD, async () => {
        try {
            const { JSONStore } = await import('./storage/store');
            const store = new JSONStore('career-hub');
            const jobs = store.read('jobs.json') || [];
            return { success: true, jobs };
        } catch (error) {
            return { success: false, error: String(error), jobs: [] };
        }
    });

    // ── Career Hub: Blocked Companies Storage ────────────────────────────
    ipcMain.handle(IPC_CHANNELS.CAREER_BLOCKED_COMPANIES_SAVE, async (event, companies: string[]) => {
        try {
            const { JSONStore } = await import('./storage/store');
            const store = new JSONStore('career-hub');
            store.write('blocked-companies.json', companies);
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_BLOCKED_COMPANIES_LOAD, async () => {
        try {
            const { JSONStore } = await import('./storage/store');
            const store = new JSONStore('career-hub');
            const companies = store.read<string[]>('blocked-companies.json') || [];
            return { success: true, companies };
        } catch (error) {
            return { success: false, error: String(error), companies: [] };
        }
    });

    // ── Career Hub: Career Profile Storage ───────────────────────────────
    ipcMain.handle(IPC_CHANNELS.CAREER_PROFILE_SAVE, async (event, profile: any) => {
        try {
            const { JSONStore } = await import('./storage/store');
            const store = new JSONStore('career-hub');
            store.write('career-profile.json', profile);
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_PROFILE_LOAD, async () => {
        try {
            const { JSONStore } = await import('./storage/store');
            const store = new JSONStore('career-hub');
            const profile = store.read('career-profile.json');
            return { success: true, profile };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    // ── Career Hub: JobSpy Scraper ───────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.CAREER_RUN_JOBSPY, async (event, options) => {
        try {
            const { runJobspySearch } = await import('./jobspy/runner');
            const data = await runJobspySearch(options, (status) => {
                event.sender.send('career:jobspy-setup-status', status);
            });
            return { success: true, data };
        } catch (error) {
            console.error('IPC: JobSpy run failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle('career:check-jobspy', async () => {
        try {
            const { checkJobspySetup } = await import('./jobspy/runner');
            return { success: true, ...checkJobspySetup() };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    // ── Career Hub: Auto-Apply Runner ────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.CAREER_RUN_APPLY, async (event, options) => {
        try {
            const { runApply } = await import('./apply/browser-use-runner');
            const data = await runApply(options, (statusUpdate) => {
                event.sender.send('career:apply-status', statusUpdate);
            });
            return { success: true, data };
        } catch (error) {
            console.error('IPC: Auto-Apply run failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_STOP_APPLY, async () => {
        try {
            const { stopApply } = await import('./apply/browser-use-runner');
            return await stopApply();
        } catch (error) {
            console.error('IPC: Auto-Apply stop failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_APPROVE_APPLY, async () => {
        try {
            const { approveApply } = await import('./apply/browser-use-runner');
            return await approveApply();
        } catch (error) {
            console.error('IPC: Auto-Apply approve failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_AUTOFILL_PAGE, async (event, options) => {
        try {
            const { autofillCurrentPage } = await import('./apply/browser-use-runner');
            return await autofillCurrentPage(options);
        } catch (error) {
            console.error('IPC: Autofill page failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_RUN_AUTOFILL_SESSION, async (event, options) => {
        try {
            const { runAutofillSession } = await import('./apply/browser-use-runner');
            return await runAutofillSession(options, (statusUpdate: any) => {
                event.sender.send('career:apply-status', statusUpdate);
            });
        } catch (error) {
            console.error('IPC: Run autofill session failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_RUN_LOGIN, async (event, site: 'linkedin' | 'default' | 'wellfound') => {
        try {
            const { runLogin } = await import('./apply/browser-use-runner');
            const data = await runLogin(site, (statusUpdate) => {
                event.sender.send('career:apply-status', statusUpdate);
            });
            return { success: true, data };
        } catch (error) {
            console.error('IPC: Auto-Apply login failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_STOP_LOGIN, async () => {
        try {
            const { stopLogin } = await import('./apply/browser-use-runner');
            return await stopLogin();
        } catch (error) {
            console.error('IPC: Auto-Apply stop login failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_CHECK_LOGIN, async (event, site: 'linkedin' | 'default' | 'wellfound') => {
        try {
            const { checkLoginStatus } = await import('./apply/browser-use-runner');
            return await checkLoginStatus(site);
        } catch (error) {
            console.error('IPC: Auto-Apply check login failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // ── Career Hub: Wellfound Auto Apply ─────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.CAREER_RUN_WELLFOUND_APPLY, async (event, options: any) => {
        try {
            const { runWellfoundApply } = await import('./apply/browser-use-runner');
            const data = await runWellfoundApply(options, (statusUpdate: any) => {
                event.sender.send('career:apply-status', statusUpdate);
            });
            return { success: true, data };
        } catch (error) {
            console.error('IPC: Wellfound apply failed:', error);
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.CAREER_STOP_WELLFOUND_APPLY, async () => {
        try {
            const { stopWellfoundApply } = await import('./apply/browser-use-runner');
            return await stopWellfoundApply();
        } catch (error) {
            console.error('IPC: Stop Wellfound apply failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // ── Career Hub: Fetch URL ────────────────────────────────────────────
    ipcMain.handle('career:fetch-url', async (event, url: string) => {
        try {
            return new Promise((resolve) => {
                const win = new BrowserWindow({
                    show: false,
                    width: 1024,
                    height: 768,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true,
                        sandbox: true
                    }
                });

                win.webContents.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

                let resolved = false;

                const finish = async () => {
                    if (resolved) return;
                    resolved = true;
                    try {
                        const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
                        win.destroy();
                        resolve({ success: true, html });
                    } catch (e) {
                        if (!win.isDestroyed()) win.destroy();
                        resolve({ success: false, error: String(e) });
                    }
                };

                win.webContents.on('did-finish-load', () => {
                    // Give client-side frameworks a moment to render
                    setTimeout(finish, 3000);
                });

                // Hard timeout
                setTimeout(finish, 15000);

                win.loadURL(url).catch((err) => {
                    if (!resolved) {
                        resolved = true;
                        if (!win.isDestroyed()) win.destroy();
                        resolve({ success: false, error: String(err) });
                    }
                });
            });
        } catch (error) {
            console.error('IPC: Fetch URL failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // ── Shell: Open External URL ─────────────────────────────────────────
    ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (event, url: string) => {
        try {
            await shell.openExternal(url);
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
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

    // Window controls
    ipcMain.handle('window:minimize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.minimize();
        return { success: true };
    });

    ipcMain.handle('window:maximize', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            if (win.isMaximized()) {
                win.unmaximize();
            } else {
                win.maximize();
            }
        }
        return { success: true };
    });

    ipcMain.handle('window:close', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) win.close();
        return { success: true };
    });

    ipcMain.handle('window:is-maximized', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return win ? win.isMaximized() : false;
    });

    // ── Deepgram Streaming STT ──────────────────────────────────────────

    ipcMain.handle(IPC_CHANNELS.DEEPGRAM_START_STREAM, async (event) => {
        try {
            const { getDeepgramStreamingManager } = await import('./whisper/deepgram-streaming');
            const manager = getDeepgramStreamingManager();

            await manager.start({
                onTranscript: (evt) => {
                    try {
                        event.sender.send('deepgram:transcript', evt);
                    } catch { /* sender may be destroyed */ }
                },
                onUtteranceEnd: (speaker) => {
                    try {
                        event.sender.send('deepgram:utterance-end', { speaker });
                    } catch { /* sender may be destroyed */ }
                },
                onSpeechStarted: (speaker) => {
                    try {
                        event.sender.send('deepgram:speech-started', { speaker });
                    } catch { /* sender may be destroyed */ }
                },
                onError: (error) => {
                    console.error('[Deepgram Stream] Error:', error);
                    try {
                        event.sender.send('deepgram:error', { error });
                    } catch { /* sender may be destroyed */ }
                },
            });

            return { success: true };
        } catch (error) {
            console.error('IPC: Deepgram start-stream failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    });

    ipcMain.handle(IPC_CHANNELS.DEEPGRAM_SEND_AUDIO, async (event, params: { speaker: 'user' | 'interviewer'; audioData: number[] }) => {
        try {
            const { getDeepgramStreamingManager } = await import('./whisper/deepgram-streaming');
            const manager = getDeepgramStreamingManager();

            if (!manager.active) {
                return { success: false, error: 'Streaming not active' };
            }

            const pcmFloat32 = new Float32Array(params.audioData);
            manager.sendAudio(params.speaker, pcmFloat32);

            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    });

    ipcMain.handle(IPC_CHANNELS.DEEPGRAM_STOP_STREAM, async () => {
        try {
            const { getDeepgramStreamingManager } = await import('./whisper/deepgram-streaming');
            const manager = getDeepgramStreamingManager();
            await manager.stop();
            return { success: true };
        } catch (error) {
            console.error('IPC: Deepgram stop-stream failed:', error);
            return { success: false, error: String(error) };
        }
    });

    // Start system session separately (called after system audio capture succeeds)
    ipcMain.handle('deepgram:start-system-session', async (event) => {
        try {
            const { getDeepgramStreamingManager } = await import('./whisper/deepgram-streaming');
            const manager = getDeepgramStreamingManager();
            await manager.startSystemSession();
            return { success: true };
        } catch (error) {
            console.error('IPC: Deepgram start-system-session failed:', error);
            return { success: false, error: String(error) };
        }
    });
}

/**
 * Register global keyboard shortcuts.
 * Called after the main window is created.
 */
export function registerGlobalShortcuts(mainWindow: BrowserWindow): void {
    // Ctrl+Shift+S → Capture screen + analyze
    globalShortcut.register('CommandOrControl+Shift+S', () => {
        mainWindow.webContents.send('shortcut:capture-screen');
    });

    // Ctrl+Shift+G → Generate answer from transcript
    globalShortcut.register('CommandOrControl+Shift+G', () => {
        mainWindow.webContents.send('shortcut:generate-answer');
    });

    // Ctrl+Shift+H → Toggle collapsed/expanded
    globalShortcut.register('CommandOrControl+Shift+H', () => {
        mainWindow.webContents.send('shortcut:toggle-widget');
    });

    // Ctrl+Shift+R → Toggle recording
    globalShortcut.register('CommandOrControl+Shift+R', () => {
        mainWindow.webContents.send('shortcut:toggle-recording');
    });

    // Ctrl+Shift+A → Region capture
    globalShortcut.register('CommandOrControl+Shift+A', () => {
        mainWindow.webContents.send('shortcut:region-capture');
    });

    // Ctrl+Shift+T → Toggle teleprompter mode
    globalShortcut.register('CommandOrControl+Shift+T', () => {
        mainWindow.webContents.send('shortcut:toggle-teleprompter');
    });

    // Ctrl+Shift+Up → Increase opacity
    globalShortcut.register('CommandOrControl+Shift+Up', () => {
        mainWindow.webContents.send('shortcut:opacity-up');
    });

    // Ctrl+Shift+Down → Decrease opacity
    globalShortcut.register('CommandOrControl+Shift+Down', () => {
        mainWindow.webContents.send('shortcut:opacity-down');
    });
}
