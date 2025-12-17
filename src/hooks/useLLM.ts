import { useState, useCallback } from 'react';

interface LLMOptions {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
}

/**
 * Hook for interacting with cloud LLM services (OpenAI/Gemini)
 * Handles streaming responses and context management
 */
export function useLLM(options: LLMOptions = {}) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Generate AI response with streaming support
     * @param prompt - User prompt or question
     * @param context - Additional context (resume, job description, etc.)
     * @param onChunk - Callback for each streamed chunk
     */
    const generateResponse = useCallback(
        async (
            prompt: string,
            context?: string,
            onChunk?: (chunk: string) => void
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

                // Call cloud LLM (OpenAI/Gemini) via IPC
                const response = await (window as any).electron.invoke('llm:generate', {
                    systemPrompt,
                    prompt: fullPrompt,
                    temperature: options.temperature ?? 0.7,
                    maxTokens: options.maxTokens ?? 512,
                    stream: !!onChunk,
                });

                if (onChunk && response.stream) {
                    // Handle streaming response
                    let fullText = '';
                    for await (const chunk of response.stream) {
                        fullText += chunk;
                        onChunk(chunk);
                    }
                    return fullText;
                } else {
                    // Handle non-streaming response
                    return response.text || '';
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
     * Generate interview answer based on question and resume
     */
    const generateInterviewAnswer = useCallback(
        async (
            question: string,
            resumeContext?: string,
            onChunk?: (chunk: string) => void
        ): Promise<string> => {
            const contextPrompt = resumeContext
                ? `Candidate Background:\n${resumeContext}\n\nInterview Question: ${question}`
                : `Interview Question: ${question}`;

            return generateResponse(contextPrompt, undefined, onChunk);
        },
        [generateResponse]
    );

    return {
        isGenerating,
        error,
        generateResponse,
        generateInterviewAnswer,
    };
}
