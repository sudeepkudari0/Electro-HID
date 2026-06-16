/**
 * LLM Adapter
 * Bridges synapse-ai's Electron LLM service with cv-tailor's LLMProvider interface.
 * This allows reusing all cv-tailor resume/cover-letter logic without modification.
 */

import type { LLMProvider, LLMResponse, GenerateOptions } from './types';

export class ElectronLLMProvider implements LLMProvider {
  async generate(prompt: string, options: GenerateOptions): Promise<LLMResponse> {
    const result = await (window as any).electronAPI.llmGenerate({
      systemPrompt: options.systemPrompt,
      prompt: prompt,
      temperature: options.temperature ?? 0.2,
      stream: false,
      task: 'tailor',
    });

    if (!result.success) {
      throw new Error(result.error || 'LLM generation failed');
    }

    return {
      content: result.text || '',
    };
  }

  getModelId(): string {
    return 'synapse-llm';
  }
}

let _instance: ElectronLLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (!_instance) {
    _instance = new ElectronLLMProvider();
  }
  return _instance;
}
