import { JSONStore } from './store';

export interface Story {
    id?: string;
    title: string;
    situation: string;
    task: string;
    action: string;
    result: string;
    tags: string[];
    metrics: string[];
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

const profileStore = new JSONStore('profile');

export const saveProfile = (profile: UserProfile): void => {
    profileStore.write('user-profile.json', profile);
};

export const loadProfile = (): UserProfile => {
    const data = profileStore.read<UserProfile>('user-profile.json');
    return data ? { ...DEFAULT_PROFILE, ...data } : { ...DEFAULT_PROFILE };
};
