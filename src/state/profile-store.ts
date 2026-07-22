import { create } from 'zustand';

export interface Story {
    id: string;
    title: string;
    situation: string;
    task: string;
    action: string;
    result: string;
    tags: string[];  // e.g., 'leadership', 'conflict', 'failure', 'teamwork', 'innovation'
    metrics: string[]; // e.g., '20% revenue increase', 'reduced latency by 3x'
    narrative: string;
    techStack: string;
    architecture: string;
    challenges: string;
    tradeoffs: string;
    mistakes: string;
    lessonsLearned: string;
    keywords: string;
    searchSummary: string;
    embeddingText: string;
}

export interface UserProfile {
    resume: string;
    jobDescription: string;
    targetCompany: string;
    targetRole: string;
    skills: string[];
    stories: Story[];
}

const DEFAULT_PROFILE: UserProfile = {
    resume: '',
    jobDescription: '',
    targetCompany: '',
    targetRole: '',
    skills: [],
    stories: [],
};

interface ProfileState {
    // State
    profile: UserProfile;
    isProfileLoaded: boolean;

    // Actions
    updateProfile: (updates: Partial<UserProfile>) => void;
    loadProfile: (profile: UserProfile) => void;
    clearProfile: () => void;
    setProfileLoaded: (loaded: boolean) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
    // Initial state
    profile: { ...DEFAULT_PROFILE },
    isProfileLoaded: false,

    // Actions
    updateProfile: (updates) =>
        set((state) => ({
            profile: { ...state.profile, ...updates },
        })),

    loadProfile: (profile) =>
        set({
            profile,
            isProfileLoaded: true,
        }),

    clearProfile: () =>
        set({
            profile: { ...DEFAULT_PROFILE },
            isProfileLoaded: false,
        }),

    setProfileLoaded: (loaded) => set({ isProfileLoaded: loaded }),
}));
