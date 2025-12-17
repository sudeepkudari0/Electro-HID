/**
 * Quick test for LLM service
 * Run with: bun run test-llm
 * 
 * Make sure to set your API key in .env first:
 * LLM_PROVIDER=openai
 * OPENAI_API_KEY=your_key_here
 */

import dotenv from 'dotenv';
import { getLLMService } from '../electron/main/llm/llm-service';

dotenv.config();

async function testLLM() {
    console.log('🧪 Testing LLM Service...\n');

    try {
        const llm = getLLMService();
        const config = llm.getConfig();

        console.log(`✅ Provider: ${config.provider}`);
        console.log(`✅ Model: ${config.model}`);
        console.log(`✅ Configured: ${llm.isConfigured()}\n`);

        console.log('📝 Testing non-streaming response...');
        const result = await llm.generate({
            systemPrompt: 'You are a helpful assistant.',
            prompt: 'Say "Hello from the cloud!" in exactly 5 words.',
            temperature: 0.7,
            maxTokens: 50,
        });

        console.log(`✅ Response: ${result.text}\n`);

        console.log('🌊 Testing streaming response...');
        const streamResult = await llm.generate({
            systemPrompt: 'You are a helpful assistant.',
            prompt: 'Count from 1 to 5.',
            temperature: 0.7,
            maxTokens: 50,
            stream: true,
        });

        if (streamResult.stream) {
            process.stdout.write('✅ Stream: ');
            for await (const chunk of streamResult.stream) {
                process.stdout.write(chunk);
            }
            console.log('\n');
        }

        console.log('✅ All tests passed!');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

testLLM();
