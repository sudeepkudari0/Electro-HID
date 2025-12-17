import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

/**
 * LLM Provider types
 */
export type LLMProvider = 'openai' | 'gemini';

/**
 * LLM generation options
 */
export interface LLMOptions {
    systemPrompt: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
}

/**
 * LLM configuration from environment
 */
interface LLMConfig {
    provider: LLMProvider;
    apiKey: string;
    model?: string;
}

/**
 * Cloud-based LLM Service
 * Supports OpenAI and Google Gemini APIs
 * 
 * Environment Variables:
 * - LLM_PROVIDER: 'openai' or 'gemini' (default: 'openai')
 * - OPENAI_API_KEY: Your OpenAI API key
 * - GEMINI_API_KEY: Your Google Gemini API key
 * - LLM_MODEL: Override default model
 */
export class LLMService {
    private config: LLMConfig;
    private openaiClient?: OpenAI;
    private geminiClient?: GoogleGenAI;

    // Default models
    private static readonly DEFAULT_MODELS = {
        openai: 'gpt-5.1', // Fast and cost-effective
        gemini: 'gemini-2.0-flash-exp', // Latest fast model
    };

    constructor(config?: Partial<LLMConfig>) {
        // Get configuration from environment or constructor
        const provider = (config?.provider || process.env.LLM_PROVIDER || 'openai') as LLMProvider;

        let apiKey = config?.apiKey;
        if (!apiKey) {
            apiKey = provider === 'openai'
                ? process.env.OPENAI_API_KEY
                : process.env.GEMINI_API_KEY;
        }

        if (!apiKey) {
            throw new Error(
                `Missing API key for ${provider}. ` +
                `Set ${provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} environment variable.`
            );
        }

        this.config = {
            provider,
            apiKey,
            model: config?.model || process.env.LLM_MODEL || LLMService.DEFAULT_MODELS[provider],
        };

        // Initialize the appropriate client
        this.initializeClient();

        console.log(`LLMService initialized with provider: ${this.config.provider}, model: ${this.config.model}`);
    }

    /**
     * Initialize API client based on provider
     */
    private initializeClient(): void {
        if (this.config.provider === 'openai') {
            this.openaiClient = new OpenAI({
                apiKey: this.config.apiKey,
            });
        } else {
            this.geminiClient = new GoogleGenAI({
                apiKey: this.config.apiKey,
            });
        }
    }

    /**
     * Generate text using the configured LLM provider
     */
    async generate(options: LLMOptions): Promise<{ text: string; stream?: AsyncIterable<string> }> {
        if (options.stream) {
            // Streaming response
            return {
                text: '',
                stream: this.streamGenerate(options),
            };
        } else {
            // Non-streaming response
            const text = await this.generateText(options);
            return { text };
        }
    }

    /**
     * Generate text (non-streaming)
     */
    private async generateText(options: LLMOptions): Promise<string> {
        if (this.config.provider === 'openai') {
            return this.generateOpenAI(options);
        } else {
            return this.generateGemini(options);
        }
    }

    /**
     * Generate streaming response
     */
    private async *streamGenerate(options: LLMOptions): AsyncIterable<string> {
        if (this.config.provider === 'openai') {
            yield* this.streamOpenAI(options);
        } else {
            yield* this.streamGemini(options);
        }
    }

    /**
     * OpenAI: Non-streaming generation
     */
    private async generateOpenAI(options: LLMOptions): Promise<string> {
        if (!this.openaiClient) {
            throw new Error('OpenAI client not initialized');
        }

        const response = await this.openaiClient.chat.completions.create({
            model: this.config.model!,
            messages: [
                { role: 'system', content: options.systemPrompt },
                { role: 'user', content: options.prompt },
            ],
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 1024,
        });

        return response.choices[0]?.message?.content || '';
    }

    /**
     * OpenAI: Streaming generation
     */
    private async *streamOpenAI(options: LLMOptions): AsyncIterable<string> {
        if (!this.openaiClient) {
            throw new Error('OpenAI client not initialized');
        }

        const stream = await this.openaiClient.chat.completions.create({
            model: this.config.model!,
            messages: [
                { role: 'system', content: options.systemPrompt },
                { role: 'user', content: options.prompt },
            ],
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 1024,
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
                yield content;
            }
        }
    }

    /**
     * Gemini: Non-streaming generation
     */
    private async generateGemini(options: LLMOptions): Promise<string> {
        if (!this.geminiClient) {
            throw new Error('Gemini client not initialized');
        }

        const response = await this.geminiClient.models.generateContent({
            model: this.config.model!,
            contents: options.prompt,
            config: {
                systemInstruction: options.systemPrompt,
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: options.maxTokens ?? 1024,
            },
        });

        return response.text || '';
    }

    /**
     * Gemini: Streaming generation
     */
    private async *streamGemini(options: LLMOptions): AsyncIterable<string> {
        if (!this.geminiClient) {
            throw new Error('Gemini client not initialized');
        }

        const stream = await this.geminiClient.models.generateContentStream({
            model: this.config.model!,
            contents: options.prompt,
            config: {
                systemInstruction: options.systemPrompt,
                temperature: options.temperature ?? 0.7,
                maxOutputTokens: options.maxTokens ?? 1024,
            },
        });

        for await (const chunk of stream) {
            const text = chunk.text;
            if (text) {
                yield text;
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
        return !!this.config.apiKey && !!this.config.model;
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
