import { useState, useEffect, useRef } from 'react';
import { X, Save, CheckCircle } from 'lucide-react';
import { ProfileSection } from './ProfileSection';
import { StoryBank } from './StoryBank';

interface SettingsPanelProps {
    onClose: () => void;
    onSettingsChanged: () => void;
}

export function SettingsPanel({ onClose, onSettingsChanged }: SettingsPanelProps) {
    const [activeTab, setActiveTab] = useState<'profile' | 'models' | 'api' | 'stories'>('profile');
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
        questionDetectionMode: 'hybrid',
        showDeliveryMetrics: true,
        useGroqProxy: false,
        groqProxyBigModel: 'moonshotai/kimi-k2-instruct-0905',
        groqProxySmallModel: 'llama-3.1-8b-instant',
        llmProvider: 'ollama' as 'ollama' | 'openai',
        openaiApiKey: '',
        openaiBaseUrl: 'https://api.openai.com/v1',
        openaiModel: 'gpt-4o-mini',
        resumeContext: ''
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
                    showDeliveryMetrics: s.showDeliveryMetrics !== false,
                    useGroqProxy: s.useGroqProxy || false,
                    groqProxyBigModel: s.groqProxyBigModel || 'moonshotai/kimi-k2-instruct-0905',
                    groqProxySmallModel: s.groqProxySmallModel || 'llama-3.1-8b-instant',
                    llmProvider: s.llmProvider || 'ollama',
                    openaiApiKey: s.openaiApiKey || '',
                    openaiBaseUrl: s.openaiBaseUrl || 'https://api.openai.com/v1',
                    openaiModel: s.openaiModel || 'gpt-4o-mini',
                    resumeContext: s.resumeContext || ''
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
                            activeTab === 'models' 
                                ? 'text-indigo-400 border-b-2 border-indigo-500' 
                                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                        onClick={() => setActiveTab('models')}
                    >
                        Models
                    </button>
                    <button
                        className={`flex-1 py-2 text-xs font-medium transition-colors ${
                            activeTab === 'api' 
                                ? 'text-indigo-400 border-b-2 border-indigo-500' 
                                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/50'
                        }`}
                        onClick={() => setActiveTab('api')}
                    >
                        API Keys
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
                    {activeTab === 'profile' ? (
                        <div className="space-y-6">
                            <ProfileSection />
                             
                             <div className="border-t border-zinc-800 pt-4 mt-2">
                                 <h3 className="text-sm font-semibold text-white mb-1">Your Background</h3>
                                 <label className="block text-[10px] text-zinc-400 mb-2">
                                     Paste your resume or background summary here for personalized practice session answers
                                 </label>
                                 <textarea
                                     value={settings.resumeContext}
                                     onChange={(e) => setSettings({ ...settings, resumeContext: e.target.value.slice(0, 3000) })}
                                     placeholder="Describe your career history, key achievements, or paste your plain-text resume here..."
                                     className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                 />
                                 <div className="text-[10px] text-zinc-500 text-right mt-1">
                                     {settings.resumeContext ? settings.resumeContext.length : 0} / 3000 characters
                                 </div>
                             </div>

                            <div className="border-t border-zinc-800 pt-4 mt-2">
                                <h3 className="text-sm font-semibold text-white mb-3">Interview Context</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-400 mb-1">
                                            Default Interview Type
                                        </label>
                                        <select
                                            value={settings.interviewType}
                                            onChange={(e) => setSettings({ ...settings, interviewType: e.target.value })}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            <option value="general">General</option>
                                            <option value="behavioral">Behavioral (STAR Method)</option>
                                            <option value="technical">Technical</option>
                                            <option value="system-design">System Design</option>
                                            <option value="coding">Coding</option>
                                            <option value="hr-screening">HR Screening</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-400 mb-1">
                                            Question Detection Mode
                                        </label>
                                        <select
                                            value={settings.questionDetectionMode}
                                            onChange={(e) => setSettings({ ...settings, questionDetectionMode: e.target.value })}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            <option value="hybrid">Hybrid (Keyword + LLM Fallback)</option>
                                            <option value="regex">Regex Only (Fast, No LLM)</option>
                                            <option value="llm">LLM Only (Accurate, Slower)</option>
                                            <option value="manual">Manual (Always use Default Type)</option>
                                        </select>
                                        <p className="text-[10px] text-zinc-500 mt-1">
                                            Hybrid uses fast keyword matching first and falls back to LLM. Settings auto-save on change.
                                        </p>
                                    </div>
                                    <div className="pt-2 border-t border-zinc-800/50 flex items-center justify-between">
                                        <div>
                                            <label className="block text-xs font-medium text-white">Live Delivery Metrics</label>
                                            <p className="text-[10px] text-zinc-500">Show talk-time and pacing stats while recording</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setSettings({ ...settings, showDeliveryMetrics: !settings.showDeliveryMetrics })}
                                            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                                                settings.showDeliveryMetrics ? 'bg-indigo-500' : 'bg-zinc-700'
                                            }`}
                                        >
                                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                                settings.showDeliveryMetrics ? 'translate-x-3.5' : 'translate-x-0.5'
                                            }`} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : activeTab === 'stories' ? (
                        <StoryBank />
                    ) : activeTab === 'models' ? (
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
                                            Please run <code className="text-zinc-300 bg-zinc-800 px-1 rounded">{settings.sttEngine === 'moonshine' ? '.\\scripts\\build-moonshine.ps1' : '.\\scripts\\setup-whisper.ps1'}</code> in your terminal to compile the sidecar.
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="pt-2 border-t border-zinc-800/50 flex items-center justify-between">
                                <div>
                                    <label className="block text-xs font-medium text-white">Transcription Mode</label>
                                    <p className="text-[10px] text-zinc-500">
                                        {settings.sttMode === 'chunks' 
                                            ? 'Continuous (Fixed 2.5s chunks - faster feedback)' 
                                            : 'Utterance-based (Wait for pause - higher accuracy)'}
                                    </p>
                                </div>
                                <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800">
                                    <button
                                        type="button"
                                        onClick={() => setSettings({ ...settings, sttMode: 'vad' })}
                                        className={`px-2.5 py-1 text-[10px] font-medium rounded transition-all duration-150 ${
                                            settings.sttMode === 'vad'
                                                ? 'bg-indigo-600 text-white'
                                                : 'text-zinc-400 hover:text-zinc-200'
                                        }`}
                                    >
                                        VAD (Utterance)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSettings({ ...settings, sttMode: 'chunks' })}
                                        className={`px-2.5 py-1 text-[10px] font-medium rounded transition-all duration-150 ${
                                            settings.sttMode === 'chunks'
                                                ? 'bg-indigo-600 text-white'
                                                : 'text-zinc-400 hover:text-zinc-200'
                                        }`}
                                    >
                                        2.5s Chunks
                                    </button>
                                </div>
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
                                            {models.length === 0 ? (
                                                <option value={settings.whisperModel}>{settings.whisperModel} (Not found)</option>
                                            ) : (
                                                models.map(model => (
                                                    <option key={model} value={model}>
                                                        {model}
                                                    </option>
                                                ))
                                            )}
                                        </select>
                                        <p className="mt-2 text-xs text-zinc-500">
                                            Select the installed transcription model to use.
                                        </p>
                                    </div>
                                    
                                    <div className="pt-4 border-t border-zinc-800">
                                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                                            Download New Model
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
                    ) : (
                        <div className="space-y-4">
                            {/* Provider Toggle */}
                            <div className="mb-4">
                                <label className="block text-xs font-medium text-zinc-400 mb-2">
                                    Primary Answer Provider
                                </label>
                                <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                                    <button
                                        type="button"
                                        onClick={() => setSettings({ ...settings, llmProvider: 'ollama' })}
                                        className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                                            settings.llmProvider === 'ollama'
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'text-zinc-400 hover:text-zinc-200'
                                        }`}
                                    >
                                        Local (Ollama / Fallbacks)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSettings({ ...settings, llmProvider: 'openai' })}
                                        className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all duration-150 ${
                                            settings.llmProvider === 'openai'
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'text-zinc-400 hover:text-zinc-200'
                                        }`}
                                    >
                                        Cloud (OpenAI)
                                    </button>
                                </div>
                            </div>

                            {/* Deepgram API Key (STT) */}
                            <div>
                                <label className="block text-sm font-medium text-zinc-300 mb-1">
                                    Deepgram API Key (Speech-to-Text)
                                </label>
                                <input
                                    type="password"
                                    value={settings.deepgramApiKey}
                                    onChange={(e) => setSettings({ ...settings, deepgramApiKey: e.target.value })}
                                    placeholder="dg_..."
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            {settings.llmProvider === 'openai' ? (
                                <div className="space-y-4 pt-2 border-t border-zinc-800">
                                    <h3 className="text-sm font-semibold text-white">OpenAI-Compatible Settings</h3>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                                            API Key
                                        </label>
                                        <input
                                            type="password"
                                            value={settings.openaiApiKey}
                                            onChange={(e) => setSettings({ ...settings, openaiApiKey: e.target.value })}
                                            placeholder="sk-proj-..."
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <p className="mt-1.5 text-[10px] text-amber-500 bg-amber-500/5 px-2.5 py-1 rounded border border-amber-500/10">
                                            ⚠️ Your API key is stored locally on your machine only.
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                                            Base URL
                                        </label>
                                        <input
                                            type="text"
                                            value={settings.openaiBaseUrl}
                                            onChange={(e) => setSettings({ ...settings, openaiBaseUrl: e.target.value })}
                                            placeholder="https://api.openai.com/v1"
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <p className="mt-1 text-[10px] text-zinc-500">
                                            Use this for OpenAI-compatible providers such as local gateways, proxies, or custom hosted APIs.
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-300 mb-1">
                                            Model Name
                                        </label>
                                        <input
                                            type="text"
                                            value={settings.openaiModel}
                                            onChange={(e) => setSettings({ ...settings, openaiModel: e.target.value })}
                                            placeholder="gpt-4o-mini"
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <p className="mt-1 text-[10px] text-zinc-500">
                                            Enter any model ID supported by the configured base URL.
                                        </p>
                                    </div>
                                    <div className="flex flex-col gap-2 pt-2">
                                        <button
                                            onClick={handleTestOpenAI}
                                            disabled={isTestingOpenAI}
                                            className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors border border-zinc-700 flex items-center justify-center gap-2"
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
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-300 mb-1 flex items-center justify-between">
                                            <span>Gemini API Key</span>
                                            {geminiVerified && (
                                                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                                                    ✓ Verified
                                                </span>
                                            )}
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                value={settings.geminiApiKey}
                                                onChange={(e) => handleApiKeyChange('gemini', e.target.value)}
                                                placeholder="AIza..."
                                                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                                            />
                                            {settings.geminiApiKey && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleVerifyKey('gemini')}
                                                    disabled={verifyingGemini}
                                                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all duration-200 flex items-center justify-center min-w-[80px] ${
                                                        geminiVerified
                                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed'
                                                    }`}
                                                >
                                                    {verifyingGemini ? 'Testing...' : geminiVerified ? 'Verified' : 'Verify'}
                                                </button>
                                            )}
                                        </div>
                                        {geminiVerificationError && (
                                            <p className="mt-1.5 text-[10px] text-red-400 bg-red-500/5 px-2.5 py-1 rounded border border-red-500/10 animate-slide-down">
                                                Verification failed: {geminiVerificationError}
                                            </p>
                                        )}
                                        {geminiVerified && geminiModels.length > 0 && (
                                            <div className="mt-2.5 pl-3 border-l-2 border-emerald-500/40 animate-slide-down space-y-1">
                                                <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                                                    Select Gemini Model
                                                </label>
                                                <select
                                                    value={settings.geminiModel}
                                                    onChange={(e) => setSettings({ ...settings, geminiModel: e.target.value })}
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                                                >
                                                    {geminiModels.map(model => (
                                                        <option key={model} value={model}>{model}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-zinc-300 mb-1 flex items-center justify-between">
                                            <span>Groq API Key (Fallback)</span>
                                            {groqVerified && (
                                                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 font-medium">
                                                    ✓ Verified
                                                </span>
                                            )}
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                value={settings.groqApiKey}
                                                onChange={(e) => handleApiKeyChange('groq', e.target.value)}
                                                placeholder="gsk_..."
                                                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                                            />
                                            {settings.groqApiKey && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleVerifyKey('groq')}
                                                    disabled={verifyingGroq}
                                                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all duration-200 flex items-center justify-center min-w-[80px] ${
                                                        groqVerified
                                                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed'
                                                    }`}
                                                >
                                                    {verifyingGroq ? 'Testing...' : groqVerified ? 'Verified' : 'Verify'}
                                                </button>
                                            )}
                                        </div>
                                        {groqVerificationError && (
                                            <p className="mt-1.5 text-[10px] text-red-400 bg-red-500/5 px-2.5 py-1 rounded border border-red-500/10 animate-slide-down">
                                                Verification failed: {groqVerificationError}
                                            </p>
                                        )}
                                        {groqVerified && groqModels.length > 0 && (
                                            <div className="mt-2.5 pl-3 border-l-2 border-emerald-500/40 animate-slide-down space-y-1">
                                                <label className="block text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                                                    Select Groq Model
                                                </label>
                                                <select
                                                    value={settings.groqModel}
                                                    onChange={(e) => setSettings({ ...settings, groqModel: e.target.value })}
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all duration-200"
                                                >
                                                    {groqModels.map(model => (
                                                        <option key={model} value={model}>{model}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    <div className="pt-2 border-t border-zinc-800 mt-4">
                                        <div className="flex items-center justify-between mb-3">
                                            <h3 className="text-sm font-semibold text-white">Local AI (Ollama)</h3>
                                            <div className="flex items-center">
                                                <span className="text-xs text-zinc-400 mr-2">Use Ollama Only</span>
                                                <button
                                                    onClick={() => setSettings({ ...settings, useOllamaOnly: !settings.useOllamaOnly })}
                                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                                                        settings.useOllamaOnly ? 'bg-indigo-600' : 'bg-zinc-700'
                                                    }`}
                                                >
                                                    <span
                                                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                                            settings.useOllamaOnly ? 'translate-x-5' : 'translate-x-1'
                                                        }`}
                                                    />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <div>
                                                <label className="block text-xs font-medium text-zinc-400 mb-1">
                                                    Ollama Base URL
                                                </label>
                                                <input
                                                    type="text"
                                                    value={settings.ollamaBaseUrl}
                                                    onChange={(e) => setSettings({ ...settings, ollamaBaseUrl: e.target.value })}
                                                    placeholder="http://localhost:11434/v1"
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-zinc-400 mb-1">
                                                    Model Name
                                                </label>
                                                <select
                                                    value={settings.ollamaModel}
                                                    onChange={(e) => setSettings({ ...settings, ollamaModel: e.target.value })}
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                                >
                                                    <option value="qwen2.5-coder:7b">qwen2.5-coder:7b (Coding & Text - Recommended)</option>
                                                    <option value="llama3.1:8b">llama3.1:8b (Strong Tool Calling - Recommended)</option>
                                                    <option value="qwen3-vl:2b">qwen3-vl:2b (Vision - Recommended)</option>
                                                    <option value="qwen3-vl:2b-instruct">qwen3-vl:2b-instruct (Vision - Direct)</option>
                                                    <option value="qwen2.5-coder:1.5b">qwen2.5-coder:1.5b (Coding & Text)</option>
                                                    <option value="deepseek-r1:1.5b">deepseek-r1:1.5b (Reasoning)</option>
                                                    <option value="llama3.2-vision">llama3.2-vision (Vision)</option>
                                                </select>
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <button
                                                    onClick={handleTestOllama}
                                                    disabled={isTesting}
                                                    className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-colors border border-zinc-700 flex items-center justify-center gap-2"
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
                                </>
                            )}

                            {/* Groq Proxy */}
                            <div className="pt-2 border-t border-zinc-800 mt-4">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-semibold text-white">Groq Proxy (for Auto-Apply)</h3>
                                    <div className="flex items-center">
                                        <span className="text-xs text-zinc-400 mr-2">Use Groq Proxy</span>
                                        <button
                                            onClick={() => setSettings({ ...settings, useGroqProxy: !settings.useGroqProxy })}
                                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                                                settings.useGroqProxy ? 'bg-indigo-600' : 'bg-zinc-700'
                                            }`}
                                        >
                                            <span
                                                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                                    settings.useGroqProxy ? 'translate-x-5' : 'translate-x-1'
                                                }`}
                                            />
                                        </button>
                                    </div>
                                </div>

                                {settings.useGroqProxy && (
                                    <div className="space-y-3 mt-2">
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-400 mb-1">
                                                Big Model (Agent / Coding)
                                            </label>
                                            <input
                                                type="text"
                                                value={settings.groqProxyBigModel}
                                                onChange={(e) => setSettings({ ...settings, groqProxyBigModel: e.target.value })}
                                                placeholder="moonshotai/kimi-k2-instruct-0905"
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-400 mb-1">
                                                Small Model (Fallback)
                                            </label>
                                            <input
                                                type="text"
                                                value={settings.groqProxySmallModel}
                                                onChange={(e) => setSettings({ ...settings, groqProxySmallModel: e.target.value })}
                                                placeholder="llama-3.1-8b-instant"
                                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            />
                                        </div>
                                        <p className="text-[10px] text-zinc-500">
                                            This routes Claude Code through a local python proxy server to run your Auto Apply tasks using fast Groq models.
                                        </p>
                                    </div>
                                )}
                            </div>

                            <p className="mt-4 text-xs text-zinc-500">
                                {settings.llmProvider === 'openai' 
                                    ? `Currently using OpenAI-compatible provider (${settings.openaiModel}).`
                                    : settings.useOllamaOnly 
                                        ? "Currently strictly using local Ollama. Cloud fallbacks are disabled." 
                                        : "Gemini is the cloud primary. Groq is the cloud fallback. Ollama is the local fallback."}
                            </p>
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
