import { useState, useCallback } from 'react';
import { getPromptTemplate, PromptContext } from '../lib/prompts';

interface LLMOptions {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
}

/**
 * Hook for interacting with cloud LLM services (OpenAI/Gemini/Ollama)
 * Handles streaming responses and context management
 */
export function useLLM(options: LLMOptions = {}) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Generate AI response with raw prompt (legacy/custom flow)
     */
    const generateResponse = useCallback(
        async (
            prompt: string,
            context?: string,
            onChunk?: (chunk: string) => void,
            imageData?: string
        ): Promise<string> => {
            setIsGenerating(true);
            setError(null);

            try {
                // Build the full prompt with context
                const systemPrompt = options.systemPrompt || `You are an expert interview coach helping a candidate answer interview questions. 
Provide structured, professional answers that:
- Are concise but complete
- Use the STAR method when appropriate
- Sound natural and conversational
- Are truthful based on the candidate's resume
- Show confidence and competence`;

                const fullPrompt = context
                    ? `Context:\n${context}\n\nQuestion:\n${prompt}\n\nProvide a professional answer:`
                    : `Question:\n${prompt}\n\nProvide a professional answer:`;

                const response = await window.electronAPI.llmGenerate({
                    systemPrompt,
                    prompt: fullPrompt,
                    temperature: options.temperature ?? 0.7,
                    maxTokens: options.maxTokens ?? 8192,
                    stream: !!onChunk,
                    imageData,
                }, onChunk);

                if (response.success) {
                    return response.text || '';
                } else {
                    throw new Error(response.error || 'Failed to generate response');
                }
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to generate response';
                setError(errorMessage);
                console.error('LLM generation error:', err);
                throw err;
            } finally {
                setIsGenerating(false);
            }
        },
        [options]
    );

    /**
     * Generate interview answer using the new Prompt Template Engine
     */
    const generateAnswerWithTemplate = useCallback(
        async (
            promptContext: PromptContext,
            onChunk?: (chunk: string) => void,
            imageData?: string,
            signal?: AbortSignal
        ): Promise<string> => {
            setIsGenerating(true);
            setError(null);

            try {
                const template = getPromptTemplate(promptContext);

                const requestId = Math.random().toString(36).substring(7);
                if (signal) {
                    signal.addEventListener('abort', () => {
                        window.electronAPI.llmAbort(requestId);
                        setIsGenerating(false);
                    });
                }

                const response = await window.electronAPI.llmGenerate({
                    systemPrompt: template.system,
                    prompt: template.user,
                    temperature: options.temperature ?? 0.7,
                    maxTokens: options.maxTokens ?? 8192,
                    stream: !!onChunk,
                    imageData,
                    requestId,
                }, onChunk);

                if (signal?.aborted) {
                    throw new Error('AbortError');
                }

                if (response.success) {
                    return response.text || '';
                } else {
                    throw new Error(response.error || 'Failed to generate response');
                }
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to generate response';
                setError(errorMessage);
                console.error('LLM generation error:', err);
                throw err;
            } finally {
                setIsGenerating(false);
            }
        },
        [options]
    );

    /**
     * Generate AI response from a raw PromptTemplate (useful for custom templates like interviewer/evaluator)
     */
    const generateFromPromptTemplate = useCallback(
        async (
            template: { system: string; user: string },
            onChunk?: (chunk: string) => void,
            format?: 'json'
        ): Promise<string> => {
            setIsGenerating(true);
            setError(null);

            try {
                const response = await window.electronAPI.llmGenerate({
                    systemPrompt: template.system,
                    prompt: template.user,
                    temperature: options.temperature ?? 0.7,
                    maxTokens: options.maxTokens ?? 8192,
                    stream: !!onChunk,
                    format: format, // Pass format if supported by IPC
                }, onChunk);

                if (response.success) {
                    return response.text || '';
                } else {
                    throw new Error(response.error || 'Failed to generate response');
                }
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'Failed to generate response';
                setError(errorMessage);
                console.error('LLM generation error:', err);
                throw err;
            } finally {
                setIsGenerating(false);
            }
        },
        [options]
    );

    /**
     * Legacy method for generating interview answers
     */
    const generateInterviewAnswer = useCallback(
        async (
            question: string,
            resumeContext?: string,
            onChunk?: (chunk: string) => void,
            signal?: AbortSignal
        ): Promise<string> => {
            // Map legacy call to the new template engine
            return generateAnswerWithTemplate({
                interviewType: 'general',
                currentQuestion: question,
                conversationHistory: '', // We don't have this in the legacy signature
                resume: resumeContext,
            }, onChunk, undefined, signal);
        },
        [generateAnswerWithTemplate]
    );

    return {
        isGenerating,
        error,
        generateResponse,
        generateInterviewAnswer,
        generateAnswerWithTemplate,
        generateFromPromptTemplate,
    };
}
