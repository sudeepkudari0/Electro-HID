import { Story } from '../../state/profile-store';

export type InterviewType = 
    | 'behavioral'
    | 'technical'
    | 'system-design'
    | 'coding'
    | 'hr-screening'
    | 'case-study'
    | 'general';

export interface PromptContext {
    interviewType: InterviewType;
    currentQuestion: string;
    conversationHistory: string;
    resume?: string;
    jobDescription?: string;
    company?: string;
    targetRole?: string;
    
    // New retrieval metadata
    selectedStory?: Story;
    retrievalSource?: 'story' | 'resume' | 'honest_fallback';
    similarityScore?: number;
    debugInfo?: any;
}

export interface PromptTemplate {
    system: string;
    user: string;
}
