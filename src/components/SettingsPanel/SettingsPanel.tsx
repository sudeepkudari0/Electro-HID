import { useState, useEffect, useRef } from 'react';
import { X, Save, CheckCircle } from 'lucide-react';
import { ProfileSection } from './ProfileSection';
import { StoryBank } from './StoryBank';

interface SettingsPanelProps {
    onClose: () => void;
    onSettingsChanged: () => void;
}

export function SettingsPanel({ onClose, onSettingsChanged }: SettingsPanelProps) {
    const [activeTab, setActiveTab] = useState<'profile' | 'stt' | 'api-keys' | 'ai-routing' | 'stories'>('profile');
    const [models, setModels] = useState<string[]>([]);
    const [geminiModels, setGeminiModels] = useState<string[]>([]);
    const [groqModels, setGroqModels] = useState<string[]>([]);
    const [geminiVerified, setGeminiVerified] = useState(false);
    const [groqVerified, setGroqVerified] = useState(false);
    const [verifyingGemini, setVerifyingGemini] = useState(false);
    const [verifyingGroq, setVerifyingGroq] = useState(false);
    const [geminiVerificationError, setGeminiVerificationError] = useState<string | null>(null);
    const [groqVerificationError, setGroqVerificationError] = useState<string | null>(null);

    const [settings, setSettings] = useState({
        sttEngine: 'moonshine' as 'whisper' | 'moonshine' | 'deepgram',
        sttMode: 'vad' as 'vad' | 'chunks',
        whisperModel: 'small.en',
        moonshineModel: 'MEDIUM_STREAMING',
        downloadedMoonshineModels: [] as string[],
        deepgramApiKey: '',
        deepgramModel: 'nova-3',
        geminiApiKey: '',
        groqApiKey: '',
        geminiModel: 'gemini-2.0-flash',
        groqModel: 'llama-3.3-70b-versatile',
        useOllamaOnly: false,
        ollamaModel: 'qwen3-vl:2b',
        ollamaBaseUrl: 'http://localhost:11434/v1',
        interviewType: 'general',
        questionDetectionMode: 'hybrid' as 'regex' | 'llm' | 'hybrid',
        autoCaptureCodingMode: false,
        showDeliveryMetrics: true,
        interviewLanguage: 'en',
        isESLMode: false,
        capsolverApiKey: '',
        llmProvider: 'ollama' as 'ollama' | 'openai',
        openaiApiKey: '',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiModel: 'gpt-4o-mini',
        resumeContext: '',
        headlessApply: false,
        interviewLlmProvider: 'ollama' as 'ollama' | 'openai' | 'gemini' | 'groq',
        interviewModel: 'qwen3-vl:2b',
        tailorLlmProvider: 'gemini' as 'ollama' | 'openai' | 'gemini' | 'groq',
        tailorModel: 'gemini-2.0-flash',
        applyLlmProvider: 'openai' as 'ollama' | 'openai' | 'gemini' | 'groq',
        applyModel: 'gpt-4o-mini'
    });
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [openaiTestResult, setOpenaiTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTestingOpenAI, setIsTestingOpenAI] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<number>(0);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [selectedDownload, setSelectedDownload] = useState('base.en');
    const [selectedMoonshineDownload, setSelectedMoonshineDownload] = useState('MEDIUM_STREAMING');
    const [serverStatus, setServerStatus] = useState<{ exists: boolean; error?: string } | null>(null);

    const downloadableModels = ['tiny.en', 'base.en', 'small.en', 'medium.en'];
    const downloadableMoonshineModels = ['TINY', 'BASE', 'TINY_STREAMING', 'BASE_STREAMING', 'SMALL_STREAMING', 'MEDIUM_STREAMING'];
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isInitialLoadRef = useRef(true);

    useEffect(() => {
        loadData();
    }, []);

    // Auto-save settings whenever they change (debounced)
    useEffect(() => {
        // Skip auto-save on initial load
        if (isInitialLoadRef.current) return;

        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }
        saveTimerRef.current = setTimeout(() => {
            autoSaveSettings();
        }, 500);

        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [settings]);

    useEffect(() => {
        window.electronAPI.checkSttServer(settings.sttEngine).then(res => setServerStatus(res));
    }, [settings.sttEngine]);

    const handleApiKeyChange = (provider: 'gemini' | 'groq', val: string) => {
        if (provider === 'gemini') {
            setSettings(prev => ({ ...prev, geminiApiKey: val }));
            setGeminiVerified(false);
            setGeminiVerificationError(null);
        } else {
            setSettings(prev => ({ ...prev, groqApiKey: val }));
            setGroqVerified(false);
            setGroqVerificationError(null);
        }
    };

    const handleVerifyKey = async (provider: 'gemini' | 'groq') => {
        // Save current input value of api keys immediately so electron service uses them
        try {
            await window.electronAPI.updateSettings(settings);
            onSettingsChanged();
        } catch (err) {
            console.error("Failed to update settings prior to key verification:", err);
        }
        await fetchCloudModels(provider, provider === 'gemini' ? settings.geminiApiKey : settings.groqApiKey, true);
    };

    const fetchCloudModels = async (provider: 'gemini' | 'groq', apiKey: string, showFeedback = false) => {
        if (!apiKey) {
            if (provider === 'gemini') {
                setGeminiVerified(false);
                setGeminiModels([]);
            } else {
                setGroqVerified(false);
                setGroqModels([]);
            }
            return;
        }

        if (provider === 'gemini') {
            setVerifyingGemini(true);
            if (showFeedback) setGeminiVerificationError(null);
        } else {
            setVerifyingGroq(true);
            if (showFeedback) setGroqVerificationError(null);
        }

        try {
            const res = await window.electronAPI.llmGetAvailableModels(provider);
            if (res.success && res.models) {
                if (provider === 'gemini') {
                    setGeminiModels(res.models);
                    setGeminiVerified(true);
                } else {
                    setGroqModels(res.models);
                    setGroqVerified(true);
                }
            } else {
                throw new Error(res.error || `Failed to verify key with ${provider} API`);
            }
        } catch (err: any) {
            console.error(`Failed to fetch ${provider} models:`, err);
            if (provider === 'gemini') {
                setGeminiVerified(false);
                if (showFeedback) {
                    setGeminiVerificationError(err.message || String(err));
                }
            } else {
                setGroqVerified(false);
                if (showFeedback) {
                    setGroqVerificationError(err.message || String(err));
                }
            }
        } finally {
            if (provider === 'gemini') {
                setVerifyingGemini(false);
            } else {
                setVerifyingGroq(false);
            }
        }
    };

    const handleInterviewProviderChange = (provider: 'ollama' | 'openai' | 'gemini' | 'groq') => {
        let defaultModel = 'gpt-4o-mini';
        if (provider === 'ollama') {
            defaultModel = 'qwen3-vl:2b';
        } else if (provider === 'gemini') {
            defaultModel = geminiModels.length > 0 ? geminiModels[0] : 'gemini-2.0-flash';
        } else if (provider === 'groq') {
            defaultModel = groqModels.length > 0 ? groqModels[0] : 'llama-3.3-70b-versatile';
        }
        setSettings(prev => ({
            ...prev,
            interviewLlmProvider: provider,
            interviewModel: defaultModel
        }));
    };

    const handleTailorProviderChange = (provider: 'ollama' | 'openai' | 'gemini' | 'groq') => {
        let defaultModel = 'gpt-4o-mini';
        if (provider === 'ollama') {
            defaultModel = 'qwen2.5-coder:7b';
        } else if (provider === 'gemini') {
            defaultModel = geminiModels.length > 0 ? geminiModels[0] : 'gemini-2.0-flash';
        } else if (provider === 'groq') {
            defaultModel = groqModels.length > 0 ? groqModels[0] : 'llama-3.3-70b-versatile';
        }
        setSettings(prev => ({
            ...prev,
            tailorLlmProvider: provider,
            tailorModel: defaultModel
        }));
    };

    const handleApplyProviderChange = (provider: 'ollama' | 'openai' | 'gemini' | 'groq') => {
        let defaultModel = 'gpt-4o-mini';
        if (provider === 'ollama') {
            defaultModel = 'qwen3-vl:2b';
        } else if (provider === 'gemini') {
            defaultModel = geminiModels.length > 0 ? geminiModels[0] : 'gemini-2.0-flash';
        } else if (provider === 'groq') {
            defaultModel = groqModels.length > 0 ? groqModels[0] : 'llama-3.3-70b-versatile';
        }
        setSettings(prev => ({
            ...prev,
            applyLlmProvider: provider,
            applyModel: defaultModel
        }));
    };

    const loadData = async () => {
        try {
            const modelsRes = await window.electronAPI.getAvailableModels();
            if (modelsRes.success && modelsRes.models) {
                setModels(modelsRes.models);
            }

            const settingsRes = await window.electronAPI.getSettings();
            if (settingsRes.success && settingsRes.settings) {
                const s = settingsRes.settings;
                setSettings({
                    sttEngine: s.sttEngine || 'moonshine',
                    sttMode: s.sttMode || 'vad',
                    whisperModel: s.whisperModel || 'small.en',
                    moonshineModel: s.moonshineModel || 'MEDIUM_STREAMING',
                    downloadedMoonshineModels: s.downloadedMoonshineModels || [],
                    deepgramApiKey: s.deepgramApiKey || '',
                    deepgramModel: s.deepgramModel || 'nova-3',
                    geminiApiKey: s.geminiApiKey || '',
                    groqApiKey: s.groqApiKey || '',
                    geminiModel: s.geminiModel || 'gemini-2.0-flash',
                    groqModel: s.groqModel || 'llama-3.3-70b-versatile',
                    useOllamaOnly: s.useOllamaOnly || false,
                    ollamaModel: s.ollamaModel || 'qwen3-vl:2b',
                    ollamaBaseUrl: s.ollamaBaseUrl || 'http://localhost:11434/v1',
                    interviewType: s.interviewType || 'general',
                    questionDetectionMode: s.questionDetectionMode || 'hybrid',
                    autoCaptureCodingMode: s.autoCaptureCodingMode || false,
                    showDeliveryMetrics: s.showDeliveryMetrics !== false,
                    interviewLanguage: s.interviewLanguage || 'en',
                    isESLMode: s.isESLMode || false,
                    capsolverApiKey: s.capsolverApiKey || '',
                    llmProvider: s.llmProvider || 'ollama',
                    openaiApiKey: s.openaiApiKey || '',
                    openaiBaseUrl: s.openaiBaseUrl || 'https://api.openai.com/v1',
                    openaiModel: s.openaiModel || 'gpt-4o-mini',
                    resumeContext: s.resumeContext || '',
                    headlessApply: s.headlessApply || false,
                    interviewLlmProvider: s.interviewLlmProvider || 'ollama',
                    interviewModel: s.interviewModel || 'qwen3-vl:2b',
                    tailorLlmProvider: s.tailorLlmProvider || 'gemini',
                    tailorModel: s.tailorModel || 'gemini-2.0-flash',
                    applyLlmProvider: s.applyLlmProvider || 'openai',
                    applyModel: s.applyModel || 'gpt-4o-mini'
                });

                // Fetch cloud models silently with loaded keys
                fetchCloudModels('gemini', s.geminiApiKey, false);
                fetchCloudModels('groq', s.groqApiKey, false);
            }
            // Mark initial load complete after state is set
            setTimeout(() => { isInitialLoadRef.current = false; }, 100);
        } catch (error) {
            console.error('Failed to load settings data:', error);
            isInitialLoadRef.current = false;
        }
    };

    const autoSaveSettings = async () => {
        try {
            await window.electronAPI.updateSettings(settings);
            onSettingsChanged();
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (error) {
            console.error('Auto-save settings failed:', error);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await window.electronAPI.updateSettings(settings);
            onSettingsChanged();
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (error) {
            console.error('Failed to save settings:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestOllama = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            // We save the settings first so the test uses the fresh values
            await window.electronAPI.updateSettings(settings);
            const res = await window.electronAPI.testOllama();
            if (res.success) {
                setTestResult({ success: true, message: `Connected! Response: ${res.message}` });
            } else {
                setTestResult({ success: false, message: `Failed: ${res.error}` });
            }
        } catch (error) {
            setTestResult({ success: false, message: `Test error: ${error}` });
        } finally {
            setIsTesting(false);
        }
    };
 
    const handleTestOpenAI = async () => {
        setIsTestingOpenAI(true);
        setOpenaiTestResult(null);
        try {
            // We save the settings first so the test uses the fresh values
            await window.electronAPI.updateSettings(settings);
            const res = await window.electronAPI.testOpenAI();
            if (res.success) {
                setOpenaiTestResult({ success: true, message: `Connected! Response: ${res.message}` });
            } else {
                setOpenaiTestResult({ success: false, message: `Failed: ${res.error}` });
            }
        } catch (error) {
            setOpenaiTestResult({ success: false, message: `Test error: ${error}` });
        } finally {
            setIsTestingOpenAI(false);
        }
    };

    const handleDownloadModel = async () => {
        setDownloadingModel(selectedDownload);
        setDownloadProgress(0);
        setDownloadError(null);
        try {
            const result = await window.electronAPI.whisper.downloadModel(selectedDownload, (progress) => {
                setDownloadProgress(progress);
            });
            if (result.success) {
                await loadData(); // refresh models list
            } else {
                setDownloadError(result.error || 'Download failed');
            }
        } catch (err: any) {
            setDownloadError(err.message || 'Download failed');
        } finally {
            setDownloadingModel(null);
        }
    };

    const handleDownloadMoonshineModel = async () => {
        setDownloadingModel(selectedMoonshineDownload);
        setDownloadProgress(0); // Progress not natively supported by this script yet, just show busy
        setDownloadError(null);
        try {
            // Fake progress since we can't easily capture python stderr progress
            const interval = setInterval(() => {
                setDownloadProgress(p => Math.min(p + 5, 95));
            }, 500);
            
            const result = await window.electronAPI.downloadMoonshineModel(selectedMoonshineDownload);
            clearInterval(interval);
            
            if (result.success) {
                setDownloadProgress(100);
                // Save to downloaded models list
                if (!settings.downloadedMoonshineModels.includes(selectedMoonshineDownload)) {
                    const newDownloaded = [...settings.downloadedMoonshineModels, selectedMoonshineDownload];
                    setSettings(prev => ({ ...prev, downloadedMoonshineModels: newDownloaded }));
                    // Immediately save to persistent store so it's not lost if app closes
                    window.electronAPI.updateSettings({ ...settings, downloadedMoonshineModels: newDownloaded }).catch(console.error);
                }
                setTimeout(() => setDownloadingModel(null), 1000);
            } else {
                setDownloadError(result.error || 'Download failed');
                setDownloadingModel(null);
            }
        } catch (err: any) {
            setDownloadError(err.message || 'Download failed');
            setDownloadingModel(null);
        }
    };

    return (
        <div className="flex flex-col flex-1 h-full border-t border-[var(--border-subtle)] animate-slide-up bg-zinc-900">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">Settings</h2>
                    {saveSuccess && (
                        <span className="flex items-center text-[10px] text-emerald-400 animate-fade-in">
                            <CheckCircle className="w-3 h-3 mr-0.5" /> Saved
                        </span>
                    )}
                </div>
                <button 
                    onClick={onClose}
                    className="p-1 text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800 transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

                {/* Tabs */}
                <div className="flex border-b border-zinc-800">
                    <button
                        className={`flex-1 py-2 text-xs font-medium transition-colors ${
                            activeTab === 'profile' 
                                ? 'text-indigo-400 border-b-2 border-indigo-500' 
                                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                        onClick={() => setActiveTab('profile')}
                    >
                        Profile
                    </button>
                    <button
                        className={`flex-1 py-2 text-xs font-medium transition-colors ${
                            activeTab === 'stories' 
                                ? 'text-indigo-400 border-b-2 border-indigo-500' 
                                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                        onClick={() => setActiveTab('stories')}
                    >
                        Story Bank
                    </button>
                    <button
                        className={`flex-1 py-2 text-xs font-medium transition-colors ${
                            activeTab === 'stt' 
                                ? 'text-indigo-400 border-b-2 border-indigo-500' 
                                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                        onClick={() => setActiveTab('stt')}
                    >
                        Speech-to-Text
                    </button>
                    <button
                        className={`flex-1 py-2 text-xs font-medium transition-colors ${
                            activeTab === 'ai-routing' 
                                ? 'text-indigo-400 border-b-2 border-indigo-500' 
                                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                        onClick={() => setActiveTab('ai-routing')}
                    >
                        AI Models
                    </button>
                    <button
                        className={`flex-1 py-2 text-xs font-medium transition-colors ${
                            activeTab === 'api-keys' 
                                ? 'text-indigo-400 border-b-2 border-indigo-500' 
                                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                        onClick={() => setActiveTab('api-keys')}
                    >
                        API Keys
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
                    {activeTab === 'profile' && (
                        <div className="space-y-6">
                            <ProfileSection />
                             
                             <div className="border-t border-zinc-800 pt-4 mt-2">
                                 <h3 className="text-sm font-semibold text-white mb-1">Your Background</h3>
                                 <label className="block text-[10px] text-zinc-400 mb-2 font-normal leading-relaxed">
                                     Paste your resume or background summary here for personalized practice session answers.
                                 </label>
                                 <textarea
                                     value={settings.resumeContext}
                                     onChange={(e) => setSettings({ ...settings, resumeContext: e.target.value })}
                                     placeholder="e.g. 5 years of experience in React..."
                                     rows={8}
                                     className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                                 />
                             </div>

                             <div className="border-t border-zinc-800 pt-4">
                                 <div className="flex items-center justify-between mb-2">
                                     <div>
                                         <h3 className="text-sm font-semibold text-white">Coding Session Mode</h3>
                                         <p className="text-[10px] text-zinc-400">
                                             Automatically capture screen code changes during coding interview questions
                                         </p>
                                     </div>
                                     <button
                                         onClick={() => setSettings({ ...settings, autoCaptureCodingMode: !settings.autoCaptureCodingMode })}
                                         className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                                             settings.autoCaptureCodingMode ? 'bg-indigo-600' : 'bg-zinc-700'
                                         }`}
                                     >
                                         <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                             settings.autoCaptureCodingMode ? 'translate-x-5' : 'translate-x-1'
                                         }`} />
                                     </button>
                                 </div>
                             </div>

                             <div className="border-t border-zinc-800 pt-4">
                                 <div className="flex items-center justify-between mb-2">
                                     <div>
                                         <h3 className="text-sm font-semibold text-white">Delivery Metrics</h3>
                                         <p className="text-[10px] text-zinc-400">
                                             Show speaking pace (WPM), hesitation rate, and grammar warnings
                                         </p>
                                     </div>
                                     <button
                                         onClick={() => setSettings({ ...settings, showDeliveryMetrics: !settings.showDeliveryMetrics })}
                                         className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                                             settings.showDeliveryMetrics ? 'bg-indigo-600' : 'bg-zinc-700'
                                         }`}
                                     >
                                         <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                             settings.showDeliveryMetrics ? 'translate-x-5' : 'translate-x-1'
                                         }`} />
                                     </button>
                                 </div>
                             </div>
                        </div>
                    )}

                    {activeTab === 'stories' && (
                        <StoryBank />
                    )}

                    {activeTab === 'stt' && (
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-zinc-300 mb-1">
                                    Speech-to-Text Engine
                                </label>
                                <select
                                    value={settings.sttEngine}
                                    onChange={(e) => setSettings({ ...settings, sttEngine: e.target.value as 'whisper' | 'moonshine' | 'deepgram' })}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="moonshine">Moonshine v2 (Fast Streaming - Recommended)</option>
                                    <option value="whisper">Whisper.cpp (Legacy C++)</option>
                                    <option value="deepgram">Deepgram (Cloud API - High Accuracy)</option>
                                </select>
                                {serverStatus && !serverStatus.exists && settings.sttEngine !== 'deepgram' && (
                                    <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded-md">
                                        <p className="text-xs text-red-400 font-semibold mb-1">Server Executable Not Found!</p>
                                        <p className="text-[10px] text-zinc-400">
                                            {serverStatus.error || "STT server backend was not found. Please compile or download the binaries."}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {settings.sttEngine === 'whisper' && (
                                <>
                                    <div className="pt-4 border-t border-zinc-800">
                                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                                            Active Whisper Model
                                        </label>
                                        <select
                                            value={settings.whisperModel}
                                            onChange={(e) => setSettings({ ...settings, whisperModel: e.target.value })}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            {models.map(model => (
                                                <option key={model} value={model}>
                                                    {model}
                                                </option>
                                            ))}
                                        </select>
                                        <p className="mt-2 text-xs text-zinc-500">
                                            Select the local model file to use for transcription.
                                        </p>
                                    </div>
                                    
                                    <div className="pt-4 border-t border-zinc-800">
                                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                                            Download Whisper Model
                                        </label>
                                        <div className="flex gap-2 mb-2">
                                            <select
                                                value={selectedDownload}
                                                onChange={(e) => setSelectedDownload(e.target.value)}
                                                disabled={downloadingModel !== null}
                                                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                                            >
                                                {downloadableModels.map(m => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={handleDownloadModel}
                                                disabled={downloadingModel !== null || models.includes(selectedDownload)}
                                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                                            >
                                                {models.includes(selectedDownload) ? 'Installed' : 'Download'}
                                            </button>
                                        </div>
                                        {downloadingModel && (
                                            <div className="mt-2">
                                                <div className="flex justify-between text-xs text-zinc-400 mb-1">
                                                    <span>Downloading {downloadingModel}...</span>
                                                    <span>{downloadProgress}%</span>
                                                </div>
                                                <div className="w-full bg-zinc-800 rounded-full h-1.5">
                                                    <div 
                                                        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" 
                                                        style={{ width: `${downloadProgress}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {downloadError && (
                                            <p className="mt-2 text-xs text-red-400">{downloadError}</p>
                                        )}
                                    </div>
                                </>
                            )}

                            {settings.sttEngine === 'moonshine' && (
                                <>
                                    <div className="pt-4 border-t border-zinc-800">
                                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                                            Active Moonshine Model
                                        </label>
                                        <select
                                            value={settings.moonshineModel}
                                            onChange={(e) => setSettings({ ...settings, moonshineModel: e.target.value })}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            {settings.downloadedMoonshineModels.length === 0 ? (
                                                <option value={settings.moonshineModel}>{settings.moonshineModel} (Not Downloaded)</option>
                                            ) : (
                                                settings.downloadedMoonshineModels.map(model => (
                                                    <option key={model} value={model}>
                                                        {model}
                                                    </option>
                                                ))
                                            )}
                                        </select>
                                        <p className="mt-2 text-xs text-zinc-500">
                                            Select the transcription model to use.
                                        </p>
                                    </div>
                                    
                                    <div className="pt-4 border-t border-zinc-800">
                                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                                            Download Moonshine Model
                                        </label>
                                        <div className="flex gap-2 mb-2">
                                            <select
                                                value={selectedMoonshineDownload}
                                                onChange={(e) => setSelectedMoonshineDownload(e.target.value)}
                                                disabled={downloadingModel !== null}
                                                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                                            >
                                                {downloadableMoonshineModels.map(m => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={handleDownloadMoonshineModel}
                                                disabled={downloadingModel !== null || settings.downloadedMoonshineModels.includes(selectedMoonshineDownload)}
                                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                                            >
                                                {settings.downloadedMoonshineModels.includes(selectedMoonshineDownload) ? 'Installed' : 'Download'}
                                            </button>
                                        </div>
                                        {downloadingModel && (
                                            <div className="mt-2">
                                                <div className="flex justify-between text-xs text-zinc-400 mb-1">
                                                    <span>Downloading {downloadingModel}...</span>
                                                    <span>{downloadProgress}%</span>
                                                </div>
                                                <div className="w-full bg-zinc-800 rounded-full h-1.5">
                                                    <div 
                                                        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300" 
                                                        style={{ width: `${downloadProgress}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {downloadError && (
                                            <p className="mt-2 text-xs text-red-400">{downloadError}</p>
                                        )}
                                    </div>
                                </>
                            )}

                            {settings.sttEngine === 'deepgram' && (
                                <div className="pt-4 border-t border-zinc-800">
                                    <label className="block text-sm font-medium text-zinc-300 mb-1">
                                        Deepgram Model
                                    </label>
                                    <select
                                        value={settings.deepgramModel}
                                        onChange={(e) => setSettings({ ...settings, deepgramModel: e.target.value })}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="nova-3">Nova 3 (Latest & Best Accuracy)</option>
                                        <option value="nova-2">Nova 2 (Fast & Highly Accurate)</option>
                                        <option value="nova-2-general">Nova 2 General</option>
                                        <option value="nova-2-medical">Nova 2 Medical</option>
                                        <option value="nova-2-meeting">Nova 2 Meeting</option>
                                        <option value="nova-2-conversational">Nova 2 Conversational</option>
                                        <option value="whisper-large">Whisper Large (Cloud)</option>
                                    </select>
                                    <p className="mt-2 text-xs text-zinc-500">
                                        Select the Deepgram cloud model. Nova 3 is highly recommended. Make sure to set your API Key in the API Keys tab.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'ai-routing' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-semibold text-white mb-3">AI Task Routing</h3>
                                <p className="text-xs text-zinc-400 mb-4 font-normal leading-relaxed">
                                    Configure which AI model and provider should power each specific task in Synapse AI.
                                </p>
                            </div>

                            {/* Interview Coach Routing */}
                            <div className="bg-zinc-950/40 p-4 rounded-xl border border-zinc-800 space-y-4">
                                <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider font-mono">Interview Coach</h4>
                                    <span className="text-[10px] text-zinc-500">Powers real-time answers & coding assist</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-medium text-zinc-400 mb-1">Provider</label>
                                        <select
                                            value={settings.interviewLlmProvider}
                                            onChange={(e) => handleInterviewProviderChange(e.target.value as any)}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            <option value="ollama">Local (Ollama)</option>
                                            <option value="gemini">Google Gemini</option>
                                            <option value="groq">Groq Cloud</option>
                                            <option value="openai">OpenAI-Compatible</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-medium text-zinc-400 mb-1">Model</label>
                                        {settings.interviewLlmProvider === 'ollama' ? (
                                            <select
                                                value={settings.interviewModel}
                                                onChange={(e) => setSettings({ ...settings, interviewModel: e.target.value })}
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                <option value="qwen3-vl:2b">qwen3-vl:2b</option>
                                                <option value="qwen3-vl:2b-instruct">qwen3-vl:2b-instruct</option>
                                                <option value="qwen2.5-coder:7b">qwen2.5-coder:7b</option>
                                                <option value="llama3.1:8b">llama3.1:8b</option>
                                                <option value="qwen2.5-coder:1.5b">qwen2.5-coder:1.5b</option>
                                                <option value="deepseek-r1:1.5b">deepseek-r1:1.5b</option>
                                                <option value="llama3.2-vision">llama3.2-vision</option>
                                            </select>
                                        ) : settings.interviewLlmProvider === 'gemini' ? (
                                            <select
                                                value={settings.interviewModel}
                                                onChange={(e) => setSettings({ ...settings, interviewModel: e.target.value })}
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                {geminiModels.length > 0 ? (
                                                    geminiModels.map(m => <option key={m} value={m}>{m}</option>)
                                                ) : (
                                                    <>
                                                        <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                                                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                                        <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                                                        <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                                                    </>
                                                )}
                                            </select>
                                        ) : settings.interviewLlmProvider === 'groq' ? (
                                            <select
                                                value={settings.interviewModel}
                                                onChange={(e) => setSettings({ ...settings, interviewModel: e.target.value })}
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                {groqModels.length > 0 ? (
                                                    groqModels.map(m => <option key={m} value={m}>{m}</option>)
                                                ) : (
                                                    <>
                                                        <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                                                        <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                                                        <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                                                    </>
                                                )}
                                            </select>
                                        ) : (
                                            <input
                                                type="text"
                                                value={settings.interviewModel}
                                                onChange={(e) => setSettings({ ...settings, interviewModel: e.target.value })}
                                                placeholder="gpt-4o-mini"
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* CV Tailoring Routing */}
                            <div className="bg-zinc-950/40 p-4 rounded-xl border border-zinc-800 space-y-4">
                                <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                                    <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono">CV Tailoring</h4>
                                    <span className="text-[10px] text-zinc-500">Powers resume & cover letter optimization</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-medium text-zinc-400 mb-1">Provider</label>
                                        <select
                                            value={settings.tailorLlmProvider}
                                            onChange={(e) => handleTailorProviderChange(e.target.value as any)}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            <option value="ollama">Local (Ollama)</option>
                                            <option value="gemini">Google Gemini</option>
                                            <option value="groq">Groq Cloud</option>
                                            <option value="openai">OpenAI-Compatible</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-medium text-zinc-400 mb-1">Model</label>
                                        {settings.tailorLlmProvider === 'ollama' ? (
                                            <select
                                                value={settings.tailorModel}
                                                onChange={(e) => setSettings({ ...settings, tailorModel: e.target.value })}
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                <option value="qwen2.5-coder:7b">qwen2.5-coder:7b</option>
                                                <option value="llama3.1:8b">llama3.1:8b</option>
                                                <option value="qwen3-vl:2b">qwen3-vl:2b</option>
                                                <option value="qwen2.5-coder:1.5b">qwen2.5-coder:1.5b</option>
                                                <option value="deepseek-r1:1.5b">deepseek-r1:1.5b</option>
                                            </select>
                                        ) : settings.tailorLlmProvider === 'gemini' ? (
                                            <select
                                                value={settings.tailorModel}
                                                onChange={(e) => setSettings({ ...settings, tailorModel: e.target.value })}
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                {geminiModels.length > 0 ? (
                                                    geminiModels.map(m => <option key={m} value={m}>{m}</option>)
                                                ) : (
                                                    <>
                                                        <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                                                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                                        <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                                                        <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                                                    </>
                                                )}
                                            </select>
                                        ) : settings.tailorLlmProvider === 'groq' ? (
                                            <select
                                                value={settings.tailorModel}
                                                onChange={(e) => setSettings({ ...settings, tailorModel: e.target.value })}
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                {groqModels.length > 0 ? (
                                                    groqModels.map(m => <option key={m} value={m}>{m}</option>)
                                                ) : (
                                                    <>
                                                        <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                                                        <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                                                        <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                                                    </>
                                                )}
                                            </select>
                                        ) : (
                                            <input
                                                type="text"
                                                value={settings.tailorModel}
                                                onChange={(e) => setSettings({ ...settings, tailorModel: e.target.value })}
                                                placeholder="gpt-4o-mini"
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Job Auto Apply Routing */}
                            <div className="bg-zinc-950/40 p-4 rounded-xl border border-zinc-800 space-y-4">
                                <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                                    <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider font-mono">Job Auto Apply</h4>
                                    <span className="text-[10px] text-zinc-500">Powers browser agent applications</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-medium text-zinc-400 mb-1">Provider</label>
                                        <select
                                            value={settings.applyLlmProvider}
                                            onChange={(e) => handleApplyProviderChange(e.target.value as any)}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            <option value="ollama">Local (Ollama)</option>
                                            <option value="gemini">Google Gemini</option>
                                            <option value="groq">Groq Cloud</option>
                                            <option value="openai">OpenAI-Compatible</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-medium text-zinc-400 mb-1">Model</label>
                                        {settings.applyLlmProvider === 'ollama' ? (
                                            <select
                                                value={settings.applyModel}
                                                onChange={(e) => setSettings({ ...settings, applyModel: e.target.value })}
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                <option value="qwen3-vl:2b">qwen3-vl:2b</option>
                                                <option value="qwen3-vl:2b-instruct">qwen3-vl:2b-instruct</option>
                                                <option value="llama3.2-vision">llama3.2-vision</option>
                                                <option value="qwen2.5-coder:7b">qwen2.5-coder:7b</option>
                                                <option value="llama3.1:8b">llama3.1:8b</option>
                                            </select>
                                        ) : settings.applyLlmProvider === 'gemini' ? (
                                            <select
                                                value={settings.applyModel}
                                                onChange={(e) => setSettings({ ...settings, applyModel: e.target.value })}
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                {geminiModels.length > 0 ? (
                                                    geminiModels.map(m => <option key={m} value={m}>{m}</option>)
                                                ) : (
                                                    <>
                                                        <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                                                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                                                        <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                                                        <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                                                    </>
                                                )}
                                            </select>
                                        ) : settings.applyLlmProvider === 'groq' ? (
                                            <select
                                                value={settings.applyModel}
                                                onChange={(e) => setSettings({ ...settings, applyModel: e.target.value })}
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            >
                                                {groqModels.length > 0 ? (
                                                    groqModels.map(m => <option key={m} value={m}>{m}</option>)
                                                ) : (
                                                    <>
                                                        <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile</option>
                                                        <option value="llama-3.1-8b-instant">llama-3.1-8b-instant</option>
                                                        <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                                                    </>
                                                )}
                                            </select>
                                        ) : (
                                            <input
                                                type="text"
                                                value={settings.applyModel}
                                                onChange={(e) => setSettings({ ...settings, applyModel: e.target.value })}
                                                placeholder="gpt-4o-mini"
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'api-keys' && (
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-semibold text-white mb-2">API Credentials</h3>
                                <p className="text-xs text-zinc-400 mb-4 leading-relaxed font-normal">
                                    Configure keys and base endpoints for your AI service accounts. All keys are stored securely on your local computer.
                                </p>
                            </div>

                            {/* Gemini API Key */}
                            <div className="bg-zinc-950/40 p-4 rounded-xl border border-zinc-800 space-y-3">
                                <label className="block text-xs font-semibold text-zinc-300 flex items-center justify-between">
                                    <span>Google Gemini API Key</span>
                                    {geminiVerified && (
                                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium font-mono">
                                            ✓ Connected
                                        </span>
                                    )}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        value={settings.geminiApiKey}
                                        onChange={(e) => handleApiKeyChange('gemini', e.target.value)}
                                        placeholder="AIza..."
                                        className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                                    />
                                    {settings.geminiApiKey && (
                                        <button
                                            type="button"
                                            onClick={() => handleVerifyKey('gemini')}
                                            disabled={verifyingGemini}
                                            className={`px-3 py-2 rounded-lg text-[10px] font-semibold border transition-all duration-200 flex items-center justify-center min-w-[70px] ${
                                                geminiVerified
                                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed'
                                            }`}
                                        >
                                            {verifyingGemini ? 'Verifying...' : geminiVerified ? 'Verified' : 'Verify'}
                                        </button>
                                    )}
                                </div>
                                {geminiVerificationError && (
                                    <p className="text-[10px] text-red-400 bg-red-500/5 px-2.5 py-1 rounded border border-red-500/10 animate-slide-down">
                                        Verification failed: {geminiVerificationError}
                                    </p>
                                )}
                            </div>

                            {/* Groq API Key */}
                            <div className="bg-zinc-950/40 p-4 rounded-xl border border-zinc-800 space-y-3">
                                <label className="block text-xs font-semibold text-zinc-300 flex items-center justify-between">
                                    <span>Groq API Key</span>
                                    {groqVerified && (
                                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium font-mono">
                                            ✓ Connected
                                        </span>
                                    )}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        value={settings.groqApiKey}
                                        onChange={(e) => handleApiKeyChange('groq', e.target.value)}
                                        placeholder="gsk_..."
                                        className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                                    />
                                    {settings.groqApiKey && (
                                        <button
                                            type="button"
                                            onClick={() => handleVerifyKey('groq')}
                                            disabled={verifyingGroq}
                                            className={`px-3 py-2 rounded-lg text-[10px] font-semibold border transition-all duration-200 flex items-center justify-center min-w-[70px] ${
                                                groqVerified
                                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed'
                                            }`}
                                        >
                                            {verifyingGroq ? 'Verifying...' : groqVerified ? 'Verified' : 'Verify'}
                                        </button>
                                    )}
                                </div>
                                {groqVerificationError && (
                                    <p className="text-[10px] text-red-400 bg-red-500/5 px-2.5 py-1 rounded border border-red-500/10 animate-slide-down">
                                        Verification failed: {groqVerificationError}
                                    </p>
                                )}
                            </div>

                            {/* OpenAI API Settings */}
                            <div className="bg-zinc-950/40 p-4 rounded-xl border border-zinc-800 space-y-3">
                                <h4 className="text-xs font-bold text-white border-b border-zinc-800 pb-1.5 mb-2 font-mono">OpenAI-Compatible Platform</h4>
                                <div>
                                    <label className="block text-[10px] font-medium text-zinc-400 mb-1">OpenAI API Key</label>
                                    <input
                                        type="password"
                                        value={settings.openaiApiKey}
                                        onChange={(e) => setSettings({ ...settings, openaiApiKey: e.target.value })}
                                        placeholder="sk-proj-..."
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-medium text-zinc-400 mb-1">OpenAI Base URL</label>
                                    <input
                                        type="text"
                                        value={settings.openaiBaseUrl}
                                        onChange={(e) => setSettings({ ...settings, openaiBaseUrl: e.target.value })}
                                        placeholder="https://api.openai.com/v1"
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-medium text-zinc-400 mb-1">OpenAI Model Name (Default / Fallback)</label>
                                    <input
                                        type="text"
                                        value={settings.openaiModel}
                                        onChange={(e) => setSettings({ ...settings, openaiModel: e.target.value })}
                                        placeholder="gpt-4o-mini"
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                                <div className="flex flex-col gap-2 pt-2">
                                    <button
                                        onClick={handleTestOpenAI}
                                        disabled={isTestingOpenAI}
                                        className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors border border-zinc-700 flex items-center justify-center gap-2"
                                    >
                                        {isTestingOpenAI ? 'Testing...' : 'Test OpenAI Connection'}
                                    </button>
                                    {openaiTestResult && (
                                        <div className={`text-[10px] px-2 py-1 rounded ${
                                            openaiTestResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                        }`}>
                                            {openaiTestResult.message}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Deepgram API Key (Speech-to-Text) */}
                            <div className="bg-zinc-950/40 p-4 rounded-xl border border-zinc-800 space-y-3">
                                <label className="block text-xs font-semibold text-zinc-300">Deepgram API Key (Speech-to-Text)</label>
                                <input
                                    type="password"
                                    value={settings.deepgramApiKey}
                                    onChange={(e) => setSettings({ ...settings, deepgramApiKey: e.target.value })}
                                    placeholder="dg_..."
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            {/* Local Ollama Settings */}
                            <div className="bg-zinc-950/40 p-4 rounded-xl border border-zinc-800 space-y-3">
                                <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-2">
                                    <h4 className="text-xs font-bold text-white font-mono">Local AI (Ollama Connection)</h4>
                                    <div className="flex items-center">
                                        <span className="text-[10px] text-zinc-400 mr-2">Use Ollama Only</span>
                                        <button
                                            onClick={() => setSettings({ ...settings, useOllamaOnly: !settings.useOllamaOnly })}
                                            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors focus:outline-none ${
                                                settings.useOllamaOnly ? 'bg-indigo-600' : 'bg-zinc-700'
                                            }`}
                                        >
                                            <span
                                                className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
                                                    settings.useOllamaOnly ? 'translate-x-3.5' : 'translate-x-0.5'
                                                }`}
                                            />
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-medium text-zinc-400 mb-1">Ollama Base URL</label>
                                    <input
                                        type="text"
                                        value={settings.ollamaBaseUrl}
                                        onChange={(e) => setSettings({ ...settings, ollamaBaseUrl: e.target.value })}
                                        placeholder="http://localhost:11434/v1"
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                                <div className="flex flex-col gap-2 pt-2">
                                    <button
                                        onClick={handleTestOllama}
                                        disabled={isTesting}
                                        className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors border border-zinc-700 flex items-center justify-center gap-2"
                                    >
                                        {isTesting ? 'Testing...' : 'Test Ollama Connection'}
                                    </button>
                                    {testResult && (
                                        <div className={`text-[10px] px-2 py-1 rounded ${
                                            testResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                        }`}>
                                            {testResult.message}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-800 bg-zinc-900/50">
                <p className="text-[10px] text-zinc-500">Settings auto-save on change</p>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white transition-colors"
                    >
                        Close
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                        <Save className="w-3.5 h-3.5 mr-1.5" />
                        {isSaving ? 'Saving...' : 'Save & Apply'}
                    </button>
                </div>
            </div>
        </div>
    );
}
