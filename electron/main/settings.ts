import path from 'path';
import fs from 'fs';
import { app } from 'electron';

export interface AppSettings {
    version: number;
    sttEngine: 'whisper' | 'moonshine' | 'deepgram';
    whisperModel: string;
    moonshineModel: string;
    downloadedMoonshineModels: string[];
    deepgramApiKey: string;
    deepgramModel: string;
    deepgramTtsModel: string;
    geminiApiKey: string;
    groqApiKey: string;
    mistralApiKey: string;
    geminiModel: string;
    groqModel: string;
    mistralModel: string;
    useOllamaOnly: boolean;
    ollamaModel: string;
    ollamaBaseUrl: string;
    interviewType: string;
    questionDetectionMode: 'regex' | 'llm' | 'hybrid';
    autoCaptureCodingMode: boolean;
    showDeliveryMetrics: boolean;
    interviewLanguage: string;
    isESLMode: boolean;
    sttMode: 'vad' | 'chunks';
    capsolverApiKey: string;
    llmProvider: 'ollama' | 'openai';
    openaiApiKey: string;
    openaiBaseUrl: string;
    openaiModel: string;
    resumeContext: string;
    headlessApply: boolean;
    interviewLlmProvider: 'ollama' | 'openai' | 'gemini' | 'groq' | 'mistral';
    interviewModel: string;
    tailorLlmProvider: 'ollama' | 'openai' | 'gemini' | 'groq' | 'mistral';
    tailorModel: string;
    applyLlmProvider: 'ollama' | 'openai' | 'gemini' | 'groq' | 'mistral';
    applyModel: string;
    autoAnswerConfidenceThreshold: number; // 0-1, questions above this confidence auto-generate answers
}

const CURRENT_VERSION = 20;

const DEFAULT_SETTINGS: AppSettings = {
    version: CURRENT_VERSION,
    sttEngine: 'moonshine',
    whisperModel: 'small.en',
    moonshineModel: 'MEDIUM_STREAMING',
    downloadedMoonshineModels: [],
    deepgramApiKey: '',
    deepgramModel: 'nova-3',
    deepgramTtsModel: 'aura-asteria-en',
    geminiApiKey: '',
    groqApiKey: '',
    mistralApiKey: '',
    geminiModel: 'gemini-2.0-flash',
    groqModel: 'llama-3.3-70b-versatile',
    mistralModel: 'mistral-large-latest',
    useOllamaOnly: false,
    ollamaModel: 'qwen3-vl:2b',
    ollamaBaseUrl: 'http://localhost:11434/v1',
    interviewType: 'general',
    questionDetectionMode: 'hybrid',
    autoCaptureCodingMode: false,
    showDeliveryMetrics: true,
    interviewLanguage: 'en',
    isESLMode: false,
    sttMode: 'vad',
    capsolverApiKey: '',
    llmProvider: 'ollama',
    openaiApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-4o-mini',
    resumeContext: '',
    headlessApply: false,
    interviewLlmProvider: 'ollama',
    interviewModel: 'qwen3-vl:2b',
    tailorLlmProvider: 'gemini',
    tailorModel: 'gemini-2.0-flash',
    applyLlmProvider: 'openai',
    applyModel: 'gpt-4o-mini',
    autoAnswerConfidenceThreshold: 0.8,
};

// Migration map: version number -> transform function
const MIGRATIONS: Record<number, (settings: any) => any> = {
    1: (settings: any) => {
        // v1 -> v2: Add profile preferences
        return {
            ...settings,
            interviewType: 'general',
            questionDetectionMode: 'hybrid',
            version: 2,
        };
    },
    2: (settings: any) => {
        // v2 -> v3: Add coding mode and delivery metrics settings
        return {
            ...settings,
            autoCaptureCodingMode: false,
            showDeliveryMetrics: true,
            version: 3,
        };
    },
    3: (settings: any) => {
        // v3 -> v4: Add language and ESL mode
        return {
            ...settings,
            interviewLanguage: 'en',
            isESLMode: false,
            version: 4,
        };
    },
    4: (settings: any) => {
        // v4 -> v5: Add sttEngine
        return {
            ...settings,
            sttEngine: 'moonshine',
            version: 5,
        };
    },
    5: (settings: any) => {
        // v5 -> v6: Add moonshineModel
        return {
            ...settings,
            moonshineModel: 'MEDIUM_STREAMING',
            version: 6,
        };
    },
    6: (settings: any) => {
        // v6 -> v7: Add downloadedMoonshineModels
        return {
            ...settings,
            downloadedMoonshineModels: [],
            version: 7,
        };
    },
    7: (settings: any) => {
        // v7 -> v8: Add Deepgram STT support
        return {
            ...settings,
            deepgramApiKey: '',
            version: 8,
        };
    },
    8: (settings: any) => {
        // v8 -> v9: Add Deepgram Model support
        return {
            ...settings,
            deepgramModel: 'nova-3',
            version: 9,
        };
    },
    9: (settings: any) => {
        // v9 -> v10: Add sttMode
        return {
            ...settings,
            sttMode: 'vad',
            version: 10,
        };
    },
    10: (settings: any) => {
        // v10 -> v11: Add geminiModel and groqModel
        return {
            ...settings,
            geminiModel: 'gemini-2.0-flash',
            groqModel: 'llama-3.3-70b-versatile',
            version: 11,
        };
    },
    11: (settings: any) => {
        // v11 -> v12: Add Groq proxy settings for Claude Code
        return {
            ...settings,
            useGroqProxy: false,
            groqProxyBigModel: 'moonshotai/kimi-k2-instruct-0905',
            groqProxySmallModel: 'llama-3.1-8b-instant',
            version: 12,
        };
    },
    12: (settings: any) => {
        // v12 -> v13: Replace Moonshot AI models (not supported by Groq) with llama-3.3-70b-versatile and enable useGroqProxy if groqApiKey is present
        const bigModel = settings.groqProxyBigModel || '';
        return {
            ...settings,
            groqProxyBigModel: (bigModel.includes('moonshot') || bigModel.includes('kimi'))
                ? 'llama-3.3-70b-versatile'
                : bigModel || 'llama-3.3-70b-versatile',
            useGroqProxy: settings.groqApiKey ? true : settings.useGroqProxy,
            version: 13,
        };
    },
    13: (settings: any) => {
        // v13 -> v14: Add OpenAI provider and resume context fields
        return {
            ...settings,
            llmProvider: settings.llmProvider || 'ollama',
            openaiApiKey: settings.openaiApiKey || '',
            openaiModel: settings.openaiModel || 'gpt-4o-mini',
            resumeContext: settings.resumeContext || '',
            version: 14,
        };
    },
    14: (settings: any) => {
        // v14 -> v15: Add OpenAI-compatible base URL setting
        return {
            ...settings,
            openaiBaseUrl: settings.openaiBaseUrl || 'https://api.openai.com/v1',
            version: 15,
        };
    },
    15: (settings: any) => {
        // v15 -> v16: Add headlessApply setting
        return {
            ...settings,
            headlessApply: false,
            version: 16,
        };
    },
    16: (settings: any) => {
        // v16 -> v17: Add task-specific providers and models
        const primary = settings.llmProvider === 'openai' ? 'openai' : (settings.useOllamaOnly ? 'ollama' : 'gemini');
        const primaryModel = (primary === 'openai' ? settings.openaiModel : (primary === 'ollama' ? settings.ollamaModel : settings.geminiModel)) || '';
        return {
            ...settings,
            interviewLlmProvider: primary,
            interviewModel: primaryModel || 'qwen3-vl:2b',
            tailorLlmProvider: settings.geminiApiKey ? 'gemini' : 'ollama',
            tailorModel: settings.geminiModel || 'gemini-2.0-flash',
            applyLlmProvider: settings.openaiApiKey ? 'openai' : 'ollama',
            applyModel: settings.openaiModel || 'gpt-4o-mini',
            version: 17,
        };
    },
    17: (settings: any) => {
        // v17 -> v18: Add auto-answer confidence threshold
        return {
            ...settings,
            autoAnswerConfidenceThreshold: 0.8,
            version: 18,
        };
    },
    18: (settings: any) => {
        // v18 -> v19: Add deepgramTtsModel
        return {
            ...settings,
            deepgramTtsModel: 'aura-asteria-en',
            version: 19,
        };
    },
    19: (settings: any) => {
        // v19 -> v20: Add Mistral AI support
        return {
            ...settings,
            mistralApiKey: '',
            mistralModel: 'mistral-large-latest',
            interviewLlmProvider: settings.interviewLlmProvider || 'ollama',
            tailorLlmProvider: settings.tailorLlmProvider || 'gemini',
            applyLlmProvider: settings.applyLlmProvider || 'openai',
            version: 20,
        };
    },
};

let settingsCache: AppSettings | null = null;

function getSettingsPath(): string {
    return path.join(app.getPath('userData'), 'settings.json');
}

function runMigrations(settings: any): AppSettings {
    let currentVersion = settings.version || 1;
    let migratedSettings = { ...settings };

    while (currentVersion < CURRENT_VERSION) {
        const migrationFn = MIGRATIONS[currentVersion];
        if (migrationFn) {
            migratedSettings = migrationFn(migratedSettings);
            currentVersion = migratedSettings.version;
        } else {
            // Missing migration path, just force to current version and merge defaults
            console.warn(`Missing migration for version ${currentVersion}`);
            migratedSettings.version = CURRENT_VERSION;
            currentVersion = CURRENT_VERSION;
        }
    }

    return { ...DEFAULT_SETTINGS, ...migratedSettings };
}

export function getSettings(): AppSettings {
    if (settingsCache) return settingsCache;

    const settingsPath = getSettingsPath();
    if (!fs.existsSync(settingsPath)) {
        settingsCache = { ...DEFAULT_SETTINGS };
        saveSettings(settingsCache);
        return settingsCache;
    }

    try {
        const data = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(data);
        
        // Run migrations if needed
        const newSettings = runMigrations(parsed);
        
        // Save if migrations occurred
        if (!parsed.version || parsed.version < CURRENT_VERSION) {
            fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf-8');
        }

        settingsCache = newSettings;
        return newSettings;
    } catch (error) {
        console.error('Failed to parse settings.json:', error);
        const newSettings = { ...DEFAULT_SETTINGS };
        settingsCache = newSettings;
        return newSettings;
    }
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
    const current = getSettings();
    const updated = { ...current, ...settings, version: CURRENT_VERSION };
    
    try {
        const settingsPath = getSettingsPath();
        fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
        settingsCache = updated;
    } catch (error) {
        console.error('Failed to save settings.json:', error);
    }
    
    return updated;
}
