// Global type declarations for renderer process

interface WhisperAPI {
  loadModel: (
    modelName?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  transcribe: (
    audioData: Float32Array,
    prompt?: string,
  ) => Promise<{
    success: boolean;
    text: string;
    words?: { word: string; start: number; end: number }[];
    error?: string;
  }>;
  getStatus: () => Promise<{
    success: boolean;
    isLoaded: boolean;
    modelPath?: string;
    error?: string;
  }>;
  downloadModel: (
    modelName: string,
    onProgress: (progress: number) => void,
  ) => Promise<{ success: boolean; error?: string }>;
}

interface DesktopSource {
  id: string;
  name: string;
  type: "screen" | "window";
}

interface ElectronAPI {
  platform: string;
  getDesktopSources: () => Promise<DesktopSource[]>;
  setIgnoreMouseEvents: (
    ignore: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  moveWindow: (
    deltaX: number,
    deltaY: number,
  ) => Promise<{ success: boolean; error?: string }>;
  whisper: WhisperAPI;
  captureScreen: (
    sourceId?: string,
  ) => Promise<{ success: boolean; imageData?: string; error?: string }>;
  analyzeScreen: (
    imageData: string,
    prompt?: string,
    context?: string,
  ) => Promise<{
    success: boolean;
    answer?: string;
    extractedText?: string;
    error?: string;
  }>;
  captureAndAnalyze: (prompt?: string) => Promise<{
    success: boolean;
    answer?: string;
    error?: string;
  }>;
  llmGenerate: (
    options: {
      systemPrompt: string;
      prompt: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      imageData?: string;
      format?: string;
    },
    onChunk?: (chunk: string) => void,
  ) => Promise<{
    success: boolean;
    text?: string;
    streaming?: boolean;
    error?: string;
  }>;
  quitApp: () => Promise<{ success: boolean; error?: string }>;

  getSettings: () => Promise<{
    success: boolean;
    settings?: any;
    error?: string;
  }>;
  updateSettings: (
    settings: any,
  ) => Promise<{ success: boolean; settings?: any; error?: string }>;
  getAvailableModels: () => Promise<{
    success: boolean;
    models?: string[];
    error?: string;
  }>;
  downloadMoonshineModel: (
    modelName: string,
  ) => Promise<{ success: boolean; error?: string }>;
  checkSttServer: (
    engine: "whisper" | "moonshine" | "deepgram",
  ) => Promise<{ exists: boolean; error?: string }>;
  testOllama: () => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  testOpenAI: () => Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }>;
  llmGetAvailableModels: (
    provider: "gemini" | "groq",
  ) => Promise<{ success: boolean; models?: string[]; error?: string }>;

  // Storage API
  session: {
    save: (session: any) => Promise<{ success: boolean; error?: string }>;
    load: (
      id: string,
    ) => Promise<{ success: boolean; session?: any; error?: string }>;
    list: () => Promise<{ success: boolean; sessions?: any[]; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
  };

  profile: {
    save: (profile: any) => Promise<{ success: boolean; error?: string }>;
    load: () => Promise<{ success: boolean; profile?: any; error?: string }>;
  };

  careerHub: {
    saveJobs: (jobs: any[]) => Promise<{ success: boolean; error?: string }>;
    loadJobs: () => Promise<{ success: boolean; jobs?: any[]; error?: string }>;
    saveProfile: (
      profile: any,
    ) => Promise<{ success: boolean; error?: string }>;
    loadProfile: () => Promise<{
      success: boolean;
      profile?: any;
      error?: string;
    }>;
    runJobspy: (
      options: any,
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    onSetupStatus: (callback: (status: string) => void) => () => void;
    fetchUrl: (
      url: string,
    ) => Promise<{ success: boolean; html?: string; error?: string }>;
    runApply: (options: {
      job: any;
      resumePdfBase64: string;
      resumeText: string;
      coverLetterText: string;
      dryRun?: boolean;
    }) => Promise<{ success: boolean; data?: any; error?: string }>;
    stopApply: () => Promise<{ success: boolean; error?: string }>;
    runLogin: (
      site: "linkedin" | "default",
    ) => Promise<{ success: boolean; data?: any; error?: string }>;
    stopLogin: () => Promise<{ success: boolean; error?: string }>;
    checkLogin: (
      site: "linkedin" | "default",
    ) => Promise<{ success: boolean; loggedIn: boolean; name?: string; error?: string }>;
    onApplyStatus: (
      callback: (eventData: {
        status: string;
        action?: string;
        log?: string;
        cost?: number;
        screenshot?: string;
      }) => void,
    ) => () => void;
    saveBlockedCompanies: (
      companies: string[],
    ) => Promise<{ success: boolean; error?: string }>;
    loadBlockedCompanies: () => Promise<{
      success: boolean;
      companies?: string[];
      error?: string;
    }>;
  };

  onShortcut: (channel: string, callback: () => void) => () => void;

  windowControl: {
    minimize: () => Promise<{ success: boolean; error?: string }>;
    maximize: () => Promise<{ success: boolean; error?: string }>;
    close: () => Promise<{ success: boolean; error?: string }>;
    isMaximized: () => Promise<boolean>;
    onStateChanged: (
      callback: (state: { isMaximized: boolean }) => void,
    ) => () => void;
  };

  deepgram: {
    startStream: () => Promise<{ success: boolean; error?: string }>;
    startSystemSession: () => Promise<{ success: boolean; error?: string }>;
    sendAudio: (speaker: 'user' | 'interviewer', audioData: number[]) => Promise<{ success: boolean; error?: string }>;
    stopStream: () => Promise<{ success: boolean; error?: string }>;
    onTranscript: (callback: (data: any) => void) => () => void;
    onUtteranceEnd: (callback: (data: { speaker: string }) => void) => () => void;
    onSpeechStarted: (callback: (data: { speaker: string }) => void) => () => void;
    onError: (callback: (data: { error: string }) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
