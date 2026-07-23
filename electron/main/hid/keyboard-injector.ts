import { keyboard, Key } from '@nut-tree-fork/nut-js';

// Configuration for nut.js keyboard
keyboard.config.autoDelayMs = 50; // Base delay between keystrokes

let isTyping = false;
let abortTyping = false;

/**
 * Randomize delay between characters to simulate human typing
 */
function getRandomDelay(min = 20, max = 80) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Helper to pause execution for a given number of milliseconds
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stop any ongoing typing sequence
 */
export function stopTyping() {
    if (isTyping) {
        abortTyping = true;
    }
}

/**
 * Simulates typing a string of text with human-like delays
 * @param text The text to inject
 */
export async function injectText(text: string): Promise<{ success: boolean; error?: string; aborted?: boolean }> {
    if (isTyping) {
        return { success: false, error: 'Already typing' };
    }

    isTyping = true;
    abortTyping = false;

    try {
        const chars = text.split('');
        for (const char of chars) {
            if (abortTyping) {
                isTyping = false;
                return { success: false, aborted: true };
            }

            // Type the character using nut.js
            // nut.js type() will handle standard characters
            await keyboard.type(char);

            // Add random human-like delay between keystrokes
            await sleep(getRandomDelay(20, 80));

            // Occasionally add a longer pause, like a human thinking or at punctuation
            if (['.', ',', ';', '\n'].includes(char)) {
                await sleep(getRandomDelay(100, 300));
            }
        }

        return { success: true };
    } catch (error) {
        console.error('Keyboard injection error:', error);
        return { success: false, error: String(error) };
    } finally {
        isTyping = false;
        abortTyping = false;
    }
}
