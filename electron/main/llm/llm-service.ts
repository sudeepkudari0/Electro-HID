import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { getSettings } from '../settings';

/**
 * LLM generation options
 */
export interface LLMOptions {
    systemPrompt: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    imageData?: string; // Base64 encoded image for vision APIs
}

/**
 * LLM configuration from environment
 */
interface LLMConfig {
    geminiApiKey: string;
    groqApiKey: string;
    geminiModel: string;
    groqModel: string;
    ollamaModel: string;
    ollamaBaseUrl: string;
    useOllamaOnly: boolean;
    llmProvider: 'ollama' | 'openai';
    openaiApiKey: string;
    openaiBaseUrl: string;
    openaiModel: string;
    resumeContext: string;
}

/**
 * Cloud-based LLM Service
 * Tries Google Gemini first, automatically falls back to Groq on error.
 * 
 * Environment Variables:
 * - GEMINI_API_KEY: Your Google Gemini API key
 * - GROQ_API_KEY: Your Groq API key
 * - GEMINI_MODEL: Override default Gemini model
 * - GROQ_MODEL: Override default Groq model
 */
export class LLMService {
    private config: LLMConfig;
    private geminiClient: GoogleGenAI;
    private groqClient: OpenAI;
    private ollamaClient: OpenAI;
    private openaiClient: OpenAI;

    // Default models
    private static readonly DEFAULT_MODELS = {
        gemini: 'gemini-2.0-flash', // Supports vision
        groq: 'llama-3.3-70b-versatile', // Highly accurate model
        ollama: 'qwen3-vl:2b', // Default local model
        openai: 'gpt-4o-mini',
    };

    constructor(config?: Partial<LLMConfig>) {
        const settings = getSettings();

        // Strip quotes if they exist in the env vars (fallback to env if not in settings)
        const cleanKey = (key?: string) => key?.replace(/^["']|["']$/g, '');
        const cleanBaseUrl = (url?: string) => {
            if (!url) return undefined;
            return url.trim().replace(/\/chat\/completions\/?$/, '').replace(/\/completions\/?$/, '');
        };
        const geminiApiKey = cleanKey(settings.geminiApiKey || process.env.GEMINI_API_KEY);
        const groqApiKey = cleanKey(settings.groqApiKey || process.env.GROQ_API_KEY);

        console.log("gemini api key available:", !!geminiApiKey);
        console.log("groq api key available:", !!groqApiKey);

        if (!geminiApiKey && !groqApiKey) {
            console.warn(`[LLMService] Warning: No API keys configured in settings. Go to settings to add them.`);
        }

        this.config = {
            geminiApiKey: geminiApiKey || '',
            groqApiKey: groqApiKey || '',
            geminiModel: settings.geminiModel || process.env.GEMINI_MODEL || LLMService.DEFAULT_MODELS.gemini,
            groqModel: settings.groqModel || process.env.GROQ_MODEL || LLMService.DEFAULT_MODELS.groq,
            ollamaModel: settings.ollamaModel || process.env.OLLAMA_MODEL || LLMService.DEFAULT_MODELS.ollama,
            ollamaBaseUrl: settings.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
            useOllamaOnly: settings.useOllamaOnly ?? false,
            llmProvider: settings.llmProvider || 'ollama',
            openaiApiKey: cleanKey(settings.openaiApiKey || process.env.OPENAI_API_KEY) || '',
            openaiBaseUrl: cleanBaseUrl(settings.openaiBaseUrl || process.env.OPENAI_BASE_URL) || 'https://api.openai.com/v1',
            openaiModel: settings.openaiModel || 'gpt-4o-mini',
            resumeContext: settings.resumeContext || '',
            ...config,
        };

        // Initialize Gemini
        if (this.config.geminiApiKey) {
            this.geminiClient = new GoogleGenAI({
                apiKey: this.config.geminiApiKey,
            });
        } else {
            this.geminiClient = null as any;
        }

        // Initialize Groq (via OpenAI SDK pointing to GroqCloud)
        if (this.config.groqApiKey) {
            this.groqClient = new OpenAI({
                apiKey: this.config.groqApiKey,
                baseURL: 'https://api.groq.com/openai/v1',
            });
        } else {
            this.groqClient = null as any;
        }

        // Initialize OpenAI (Cloud)
        if (this.config.openaiApiKey) {
            this.openaiClient = new OpenAI({
                apiKey: this.config.openaiApiKey,
                baseURL: this.config.openaiBaseUrl,
            });
        } else {
            this.openaiClient = null as any;
        }

        // Initialize Ollama (via OpenAI SDK pointing to local instance)
        this.ollamaClient = new OpenAI({
            apiKey: 'ollama', // Dummy key required by SDK
            baseURL: this.config.ollamaBaseUrl,
        });
    }

    /**
     * Generate text with automatic fallback from Gemini to Groq
     */
    async generate(options: LLMOptions): Promise<{ text: string; stream?: AsyncIterable<string> }> {
        let systemPrompt = options.systemPrompt;
        if (this.config.resumeContext && this.config.resumeContext.trim()) {
            systemPrompt = `The candidate's background: ${this.config.resumeContext.trim()}\nGenerate answers that reference their specific experience where relevant.\n\n${systemPrompt}`;
        }
        const updatedOptions = { ...options, systemPrompt };

        if (updatedOptions.stream) {
            return {
                text: '',
                stream: this.streamGenerateWithFallback(updatedOptions),
            };
        } else {
            const text = await this.generateTextWithFallback(updatedOptions);
            return { text };
        }
    }

    /**
     * Non-streaming fallback mechanism
     */
    private async generateTextWithFallback(options: LLMOptions): Promise<string> {
        if (this.config.llmProvider === 'openai') {
            console.log(`[LLMService] Using OpenAI provider (${this.config.openaiModel})...`);
            return await this.generateOpenAI(options);
        }

        if (this.config.useOllamaOnly) {
            console.log(`[LLMService] useOllamaOnly is enabled. Trying Ollama (${this.config.ollamaModel})...`);
            return await this.generateOllama(options);
        }

        // Try Gemini first if key exists
        if (this.geminiClient) {
            try {
                console.log('[LLMService] Trying Gemini...');
                return await this.generateGemini(options);
            } catch (error) {
                console.error('[LLMService] Gemini failed:', error, '- Falling back...');
            }
        }

        // Try Groq next if key exists
        if (this.groqClient) {
            try {
                console.log('[LLMService] Trying Groq...');
                return await this.generateGroq(options);
            } catch (error) {
                console.error('[LLMService] Groq failed:', error, '- Falling back to Ollama...');
            }
        }

        // Ultimate fallback to Ollama
        console.log(`[LLMService] Trying local Ollama fallback (${this.config.ollamaModel})...`);
        try {
            return await this.generateOllama(options);
        } catch (error) {
            console.error('[LLMService] Ollama fallback failed:', error);
            throw new Error(`All LLM providers failed. Last error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Streaming fallback mechanism
     */
    private async *streamGenerateWithFallback(options: LLMOptions): AsyncIterable<string> {
        if (this.config.llmProvider === 'openai') {
            console.log(`[LLMService] Using OpenAI provider Stream (${this.config.openaiModel})...`);
            yield* this.streamOpenAI(options);
            return;
        }

        if (this.config.useOllamaOnly) {
            console.log(`[LLMService] useOllamaOnly is enabled. Trying Ollama Stream (${this.config.ollamaModel})...`);
            yield* this.streamOllama(options);
            return;
        }

        // 1. Try Gemini Stream first if key exists
        if (this.geminiClient) {
            try {
                console.log('[LLMService] Trying Gemini (Stream)...');
                const stream = this.streamGemini(options);
                const iterator = stream[Symbol.asyncIterator]();
                let firstResult = await iterator.next();

                if (!firstResult.done) {
                    yield firstResult.value;
                    while (true) {
                        const result = await iterator.next();
                        if (result.done) break;
                        yield result.value;
                    }
                    return; // Stream succeeded, exit generator
                }
            } catch (error) {
                console.error('[LLMService] Gemini Stream failed:', error, '- Falling back...');
            }
        }

        // 2. Try Groq Stream next if key exists
        if (this.groqClient) {
            try {
                console.log('[LLMService] Trying Groq (Stream)...');
                const stream = this.streamGroq(options);
                const iterator = stream[Symbol.asyncIterator]();
                let firstResult = await iterator.next();

                if (!firstResult.done) {
                    yield firstResult.value;
                    while (true) {
                        const result = await iterator.next();
                        if (result.done) break;
                        yield result.value;
                    }
                    return; // Stream succeeded, exit generator
                }
            } catch (error) {
                console.error('[LLMService] Groq Stream failed:', error, '- Falling back to Ollama...');
            }
        }

        // 3. Ultimate fallback to Ollama Stream
        console.log(`[LLMService] Trying local Ollama Stream fallback (${this.config.ollamaModel})...`);
        try {
            yield* this.streamOllama(options);
        } catch (error) {
            console.error('[LLMService] Ollama Stream fallback failed:', error);
            throw new Error(`All LLM streaming providers failed. Last error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // ─── Gemini Implementation ───

    private async generateGemini(options: LLMOptions): Promise<string> {
        const contentParts: any[] = [{ text: options.prompt }];

        if (options.imageData) {
            contentParts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: options.imageData,
                },
            });
        }

        const response = await this.geminiClient.models.generateContent({
            model: this.config.geminiModel,
            contents: contentParts,
            config: {
                systemInstruction: options.systemPrompt,
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: options.maxTokens ?? 1024,
            },
        });

        return response.text || '';
    }

    private async *streamGemini(options: LLMOptions): AsyncIterable<string> {
        const contentParts: any[] = [{ text: options.prompt }];

        if (options.imageData) {
            contentParts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: options.imageData,
                },
            });
        }

        const stream = await this.geminiClient.models.generateContentStream({
            model: this.config.geminiModel,
            contents: contentParts,
            config: {
                systemInstruction: options.systemPrompt,
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: options.maxTokens ?? 1024,
            },
        });

        for await (const chunk of stream) {
            if (chunk.text) {
                yield chunk.text;
            }
        }
    }

    // ─── Groq Implementation ───

    private async generateGroq(options: LLMOptions): Promise<string> {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: options.systemPrompt },
        ];

        if (options.imageData) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: options.prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${options.imageData}`,
                        },
                    },
                ],
            });
        } else {
            messages.push({ role: 'user', content: options.prompt });
        }

        const response = await this.groqClient.chat.completions.create({
            model: this.config.groqModel,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
        });

        return response.choices[0]?.message?.content || '';
    }

    private async *streamGroq(options: LLMOptions): AsyncIterable<string> {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: options.systemPrompt },
        ];

        if (options.imageData) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: options.prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${options.imageData}`,
                        },
                    },
                ],
            });
        } else {
            messages.push({ role: 'user', content: options.prompt });
        }

        const stream = await this.groqClient.chat.completions.create({
            model: this.config.groqModel,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                yield content;
            }
        }
    }

    // ─── Ollama Implementation ───

    private async generateOllama(options: LLMOptions): Promise<string> {
        const directSystemPrompt = options.systemPrompt + "\n\nCRITICAL: Do not include any internal thought process, reasoning steps, or preamble. Provide only the direct answer.";

        const messages: any[] = [
            { role: 'system', content: directSystemPrompt },
        ];

        if (options.imageData) {
            const rawBase64 = options.imageData.replace(/^data:image\/\w+;base64,/, '');
            messages.push({
                role: 'user',
                content: options.prompt,
                images: [rawBase64], // Ollama native API expects base64 without data URI prefix
            });
        } else {
            messages.push({ role: 'user', content: options.prompt });
        }

        try {
            const baseUrl = this.config.ollamaBaseUrl.replace(/\/v1\/?$/, '');
            const response = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.config.ollamaModel,
                    messages,
                    stream: false,
                    think: false, // This natively disables thinking for Qwen3-VL/DeepSeek-R1 in Ollama
                    options: {
                        temperature: 0,
                        num_predict: options.maxTokens,
                    }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Ollama API error (${response.status}): ${errText}`);
            }

            const data = await response.json() as any;
            return data.message?.content || '';
        } catch (error: any) {
            if (error.message && (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED'))) {
                throw new Error(`Ollama not reachable at ${this.config.ollamaBaseUrl}. Please ensure Ollama is running.`);
            }
            if (error.message && error.message.includes('not found')) {
                throw new Error(`Ollama model "${this.config.ollamaModel}" not found. Please pull it first.`);
            }
            throw error;
        }
    }

    private async *streamOllama(options: LLMOptions): AsyncIterable<string> {
        const directSystemPrompt = options.systemPrompt + "/no_think - Provide only the direct answer.";

        const messages: any[] = [
            { role: 'system', content: directSystemPrompt },
        ];

        if (options.imageData) {
            const rawBase64 = options.imageData.replace(/^data:image\/\w+;base64,/, '');
            messages.push({
                role: 'user',
                content: options.prompt,
                images: [rawBase64],
            });
        } else {
            messages.push({ role: 'user', content: options.prompt });
        }

        try {
            const baseUrl = this.config.ollamaBaseUrl.replace(/\/v1\/?$/, '');

            const payload = {
                model: this.config.ollamaModel,
                messages,
                stream: true,
                think: false, // This natively disables thinking for Qwen3-VL/DeepSeek-R1 in Ollama
                options: {
                    temperature: 0,
                    num_predict: options.maxTokens,
                }
            };

            console.log(`[LLMService] Sending Ollama request to ${baseUrl}/api/chat with think: false, streaming enabled...`);

            const response = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Ollama API error (${response.status}): ${errText}`);
            }

            if (!response.body) {
                throw new Error("No response body received from Ollama");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    if (buffer.trim()) {
                        try {
                            const data = JSON.parse(buffer) as any;
                            if (data.message?.content) yield data.message.content;
                        } catch (e) { }
                    }
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                let newlineIdx;
                while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIdx);
                    buffer = buffer.slice(newlineIdx + 1);
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line) as any;
                        if (data.message?.content) {
                            yield data.message.content;
                        } else if (data.message && typeof data.message.content === 'string') {
                            // Empty string chunk
                        } else if (data.error) {
                            console.error(`[LLMService] stream error from Ollama:`, data.error);
                        }
                    } catch (e) {
                        // ignore malformed JSON lines
                    }
                }
            }
        } catch (error: any) {
            if (error.message && (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED'))) {
                throw new Error(`Ollama not reachable at ${this.config.ollamaBaseUrl}. Please ensure Ollama is running.`);
            }
            if (error.message && error.message.includes('not found')) {
                throw new Error(`Ollama model "${this.config.ollamaModel}" not found. Please pull it first.`);
            }
            throw error;
        }
    }

    /**
     * Fetch available models for Gemini or Groq from their APIs.
     * Falls back to a curated list if API keys are missing or requests fail.
     */
    async listModels(provider: 'gemini' | 'groq'): Promise<string[]> {
        if (provider === 'gemini') {
            const fallbackModels = [
                'gemini-2.5-flash',
                'gemini-2.0-flash',
                'gemini-2.0-flash-lite',
                'gemini-1.5-flash',
                'gemini-1.5-pro'
            ];
            if (!this.config.geminiApiKey) {
                return fallbackModels;
            }
            try {
                if (this.geminiClient && this.geminiClient.models && typeof this.geminiClient.models.list === 'function') {
                    const response = await this.geminiClient.models.list() as any;
                    if (response && Array.isArray(response.models)) {
                        return response.models
                            .map((m: any) => m.name ? m.name.replace(/^models\//, '') : String(m))
                            .filter((name: string) => name.includes('gemini'));
                    }
                }
                return fallbackModels;
            } catch (error) {
                console.error('[LLMService] Failed to fetch Gemini models from API, using fallback list:', error);
                return fallbackModels;
            }
        } else {
            const fallbackModels = [
                'llama-3.3-70b-versatile',
                'llama-3.1-8b-instant',
                'llama-3.1-70b-versatile',
                'mixtral-8x7b-32768',
                'gemma2-9b-it'
            ];
            if (!this.config.groqApiKey) {
                return fallbackModels;
            }
            try {
                if (this.groqClient && this.groqClient.models && typeof this.groqClient.models.list === 'function') {
                    const response = await this.groqClient.models.list();
                    if (response && Array.isArray(response.data)) {
                        return response.data.map((m: any) => m.id);
                    }
                }
                return fallbackModels;
            } catch (error) {
                console.error('[LLMService] Failed to fetch Groq models from API, using fallback list:', error);
                return fallbackModels;
            }
        }
    }

    /**
     * Get current configuration
     */
    getConfig(): Readonly<LLMConfig> {
        return { ...this.config };
    }

    /**
     * Check if the service is properly configured
     */
    isConfigured(): boolean {
        return !!this.config.geminiApiKey && !!this.config.groqApiKey;
    }

    // ─── OpenAI Implementation ───

    private async generateOpenAI(options: LLMOptions): Promise<string> {
        if (!this.openaiClient) {
            throw new Error("OpenAI API key is not configured. Please add it in Settings.");
        }
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: options.systemPrompt },
        ];

        if (options.imageData) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: options.prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${options.imageData}`,
                        },
                    },
                ],
            });
        } else {
            messages.push({ role: 'user', content: options.prompt });
        }

        const response = await this.openaiClient.chat.completions.create({
            model: this.config.openaiModel || 'gpt-4o-mini',
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
        });

        return response.choices[0]?.message?.content || '';
    }

    private async *streamOpenAI(options: LLMOptions): AsyncIterable<string> {
        if (!this.openaiClient) {
            throw new Error("OpenAI API key is not configured. Please add it in Settings.");
        }
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: 'system', content: options.systemPrompt },
        ];

        if (options.imageData) {
            messages.push({
                role: 'user',
                content: [
                    { type: 'text', text: options.prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${options.imageData}`,
                        },
                    },
                ],
            });
        } else {
            messages.push({ role: 'user', content: options.prompt });
        }

        const stream = await this.openaiClient.chat.completions.create({
            model: this.config.openaiModel || 'gpt-4o-mini',
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens,
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                yield content;
            }
        }
    }
}

// Singleton instance
let llmService: LLMService | null = null;

/**
 * Get LLMService singleton instance
 * @param config - Optional configuration override
 */
export function getLLMService(config?: Partial<LLMConfig>): LLMService {
    if (!llmService) {
        llmService = new LLMService(config);
    }
    return llmService;
}

/**
 * Reset the singleton instance (useful for testing or changing providers)
 */
export function resetLLMService(): void {
    llmService = null;
}
