import { create } from 'zustand';

// ─── Answer Option (variant for a single question) ───
export interface AnswerOption {
    id: string;
    style: 'strategic' | 'technological' | 'process-driven';
    styleLabel: string;
    answer: string;
    isStreaming: boolean;
}

// ─── Candidate Question (detected, waiting for user to pick) ───
export interface CandidateQuestion {
    id: string;
    text: string;               // The detected question text
    timestamp: Date;
    confidence: number;         // Detection confidence (0-1)
    signals: string[];          // Which detection signals fired
    status: 'pending' | 'answering' | 'answered';
    // Inline answer (generated when user clicks the question)
    answer?: string;
    isStreaming?: boolean;
}

// Legacy Answer interface — kept for backward compatibility (screen capture, etc.)
export interface Answer {
    id: string;
    source: 'transcript' | 'screen-capture';
    question: string;
    answer: string;
    timestamp: Date;
    isStreaming?: boolean;
    detectedType?: string;
    followUps?: string[];
}

// ─── Deduplication utility ───

/**
 * Check if a new question is a longer/fuller version of an existing one,
 * or if they're substantially the same question.
 * Returns the index of the matching candidate, or -1 if no match.
 */
function findDuplicateIndex(candidates: CandidateQuestion[], newText: string): number {
    const normalizedNew = newText.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const newWords = normalizedNew.split(/\s+/);

    for (let i = 0; i < candidates.length; i++) {
        // Skip already-answered questions (don't merge into those)
        if (candidates[i].status === 'answered' || candidates[i].status === 'answering') continue;

        const normalizedOld = candidates[i].text.toLowerCase().replace(/[^\w\s]/g, '').trim();
        const oldWords = normalizedOld.split(/\s+/);

        // Check 1: Substring/prefix match (old is prefix of new or vice versa)
        if (normalizedNew.startsWith(normalizedOld.slice(0, Math.min(normalizedOld.length, 30)))) {
            return i;
        }
        if (normalizedOld.startsWith(normalizedNew.slice(0, Math.min(normalizedNew.length, 30)))) {
            return i;
        }

        // Check 2: Word overlap — if 70%+ of the shorter text's words appear in the longer
        const shorter = oldWords.length <= newWords.length ? oldWords : newWords;
        const longer = oldWords.length <= newWords.length ? newWords : oldWords;
        const longerSet = new Set(longer);
        const overlap = shorter.filter(w => longerSet.has(w)).length;
        const overlapRatio = shorter.length > 0 ? overlap / shorter.length : 0;

        if (overlapRatio >= 0.7 && shorter.length >= 3) {
            return i;
        }
    }

    return -1;
}

// ─── Detected Questions (new multi-option model, kept for backward compat) ───
export interface DetectedQuestion {
    id: string;
    questionText: string;
    timestamp: Date;
    interviewType?: string;
    options: AnswerOption[];
    isGenerating: boolean;
    selectedOptionId?: string;
}

interface AnswerState {
    // Candidate questions (detected, with inline answers)
    candidateQuestions: CandidateQuestion[];

    // Legacy: Detected questions with multi-option answers (kept for backward compat)
    detectedQuestions: DetectedQuestion[];
    expandedQuestionId: string | null;

    // Legacy: single answers (for screen capture, manual generate, etc.)
    answers: Answer[];
    currentAnswerIndex: number;
    isGenerating: boolean;

    // ─── Candidate question actions ───
    addCandidateQuestion: (text: string, confidence: number, signals: string[]) => string;
    removeCandidateQuestion: (id: string) => void;
    clearCandidateQuestions: () => void;
    setCandidateStatus: (id: string, status: CandidateQuestion['status']) => void;
    updateCandidateAnswer: (id: string, updates: Partial<Pick<CandidateQuestion, 'answer' | 'isStreaming' | 'status'>>) => void;

    // ─── Detected question actions (kept for backward compat) ───
    addDetectedQuestion: (question: DetectedQuestion) => void;
    updateQuestionOption: (questionId: string, optionId: string, updates: Partial<AnswerOption>) => void;
    selectOption: (questionId: string, optionId: string) => void;
    setExpandedQuestion: (questionId: string | null) => void;
    removeDetectedQuestion: (questionId: string) => void;
    clearDetectedQuestions: () => void;
    setQuestionGenerating: (questionId: string, generating: boolean) => void;

    // ─── Legacy actions ───
    addAnswer: (answer: Answer) => void;
    updateAnswer: (id: string, updates: Partial<Answer>) => void;
    removeAnswer: (id: string) => void;
    navigateAnswer: (index: number) => void;
    clearAnswers: () => void;
    setIsGenerating: (generating: boolean) => void;
}

export const useAnswerStore = create<AnswerState>((set) => ({
    // State
    candidateQuestions: [],
    detectedQuestions: [],
    expandedQuestionId: null,
    answers: [],
    currentAnswerIndex: 0,
    isGenerating: false,

    // ─── Candidate question actions ───

    addCandidateQuestion: (text, confidence, signals) => {
        let returnedId = '';
        set((state) => {
            const dupIndex = findDuplicateIndex(state.candidateQuestions, text);

            if (dupIndex >= 0) {
                // Merge: replace the old partial question with the newer (presumably fuller) text
                const existing = state.candidateQuestions[dupIndex];
                const isNewLonger = text.trim().length >= existing.text.trim().length;

                const updated = [...state.candidateQuestions];
                updated[dupIndex] = {
                    ...existing,
                    text: isNewLonger ? text : existing.text, // Keep the longer version
                    confidence: Math.max(existing.confidence, confidence),
                    signals: [...new Set([...existing.signals, ...signals])],
                    timestamp: new Date(), // Update timestamp
                };

                returnedId = existing.id;
                return { candidateQuestions: updated };
            }

            // No duplicate — add as new candidate
            const newId = Date.now().toString() + Math.random().toString(36).slice(2, 6);
            returnedId = newId;
            const newCandidate: CandidateQuestion = {
                id: newId,
                text,
                timestamp: new Date(),
                confidence,
                signals,
                status: 'pending',
            };

            return {
                candidateQuestions: [newCandidate, ...state.candidateQuestions], // newest first
            };
        });
        return returnedId;
    },

    removeCandidateQuestion: (id) =>
        set((state) => ({
            candidateQuestions: state.candidateQuestions.filter((q) => q.id !== id),
        })),

    clearCandidateQuestions: () =>
        set({ candidateQuestions: [] }),

    setCandidateStatus: (id, status) =>
        set((state) => ({
            candidateQuestions: state.candidateQuestions.map((q) =>
                q.id === id ? { ...q, status } : q
            ),
        })),

    updateCandidateAnswer: (id, updates) =>
        set((state) => ({
            candidateQuestions: state.candidateQuestions.map((q) =>
                q.id === id ? { ...q, ...updates } : q
            ),
        })),

    // ─── Detected question actions (after user picks) ───

    addDetectedQuestion: (question) =>
        set((state) => ({
            detectedQuestions: [question, ...state.detectedQuestions],
        })),

    updateQuestionOption: (questionId, optionId, updates) =>
        set((state) => ({
            detectedQuestions: state.detectedQuestions.map((q) =>
                q.id === questionId
                    ? {
                          ...q,
                          options: q.options.map((opt) =>
                              opt.id === optionId ? { ...opt, ...updates } : opt
                          ),
                      }
                    : q
            ),
        })),

    selectOption: (questionId, optionId) =>
        set((state) => ({
            detectedQuestions: state.detectedQuestions.map((q) =>
                q.id === questionId ? { ...q, selectedOptionId: optionId } : q
            ),
            expandedQuestionId: questionId,
        })),

    setExpandedQuestion: (questionId) =>
        set({ expandedQuestionId: questionId }),

    removeDetectedQuestion: (questionId) =>
        set((state) => ({
            detectedQuestions: state.detectedQuestions.filter((q) => q.id !== questionId),
            expandedQuestionId:
                state.expandedQuestionId === questionId ? null : state.expandedQuestionId,
        })),

    clearDetectedQuestions: () =>
        set({ detectedQuestions: [], expandedQuestionId: null }),

    setQuestionGenerating: (questionId, generating) =>
        set((state) => ({
            detectedQuestions: state.detectedQuestions.map((q) =>
                q.id === questionId ? { ...q, isGenerating: generating } : q
            ),
        })),

    // ─── Legacy actions ───

    addAnswer: (answer) =>
        set((state) => ({
            answers: [...state.answers, answer],
            currentAnswerIndex: state.answers.length,
        })),

    updateAnswer: (id, updates) =>
        set((state) => ({
            answers: state.answers.map((a) =>
                a.id === id ? { ...a, ...updates } : a
            ),
        })),

    removeAnswer: (id) =>
        set((state) => {
            const filtered = state.answers.filter((a) => a.id !== id);
            return {
                answers: filtered,
                currentAnswerIndex: Math.min(
                    state.currentAnswerIndex,
                    Math.max(0, filtered.length - 1)
                ),
            };
        }),

    navigateAnswer: (index) =>
        set((state) => ({
            currentAnswerIndex: Math.max(0, Math.min(index, state.answers.length - 1)),
        })),

    clearAnswers: () =>
        set({ answers: [], currentAnswerIndex: 0 }),

    setIsGenerating: (generating) => set({ isGenerating: generating }),
}));
