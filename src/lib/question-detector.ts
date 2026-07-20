/**
 * Multi-signal question detection for interview transcripts.
 *
 * Instead of a regex+LLM race, this uses a weighted scoring system
 * across multiple linguistic signals. Designed to run on complete
 * utterances (after onSpeechEnd), not partial chunks.
 */

export type DetectionMode = 'regex' | 'llm' | 'hybrid' | 'heuristic';

export interface DetectionResult {
    isQuestion: boolean;
    confidence: number;
    signals: string[]; // which signals contributed
    syntacticallyComplete?: boolean;
}

// ─── Signal 1: Question mark ───
function checkQuestionMark(text: string): number {
    return text.includes('?') ? 50 : 0;
}

// ─── Signal 2: Interrogative opening patterns ───
const INTERROGATIVE_OPEN = /^(what|where|when|why|who|how|can you|could you|would you|should you|do you|did you|have you|are you|is there|are there|were you|will you|shall we)/i;

function checkInterrogativeOpening(text: string): number {
    return INTERROGATIVE_OPEN.test(text.trim()) ? 30 : 0;
}

// ─── Signal 3: Directive/imperative patterns (anywhere) ───
const DIRECTIVE_PATTERNS = /\b(tell me|describe|explain|walk me through|give me an example|talk about|share with me|discuss|elaborate on|walk through|take me through|show me|demonstrate|outline|compare|contrast)\b/i;

function checkDirectivePattern(text: string): number {
    return DIRECTIVE_PATTERNS.test(text) ? 25 : 0;
}

// ─── Signal 4: Interrogative words anywhere ───
const INTERROGATIVE_ANYWHERE = /\b(what|why|how|when|where|who|which)\b/i;

function checkInterrogativeAnywhere(text: string): number {
    return INTERROGATIVE_ANYWHERE.test(text) ? 10 : 0;
}

// ─── Signal 5: Common interview question starters ───
const INTERVIEW_STARTERS = /\b(tell me about a time|give me an example|can you describe|how would you|what would you do|what's your|what is your|how do you|have you ever|why did you|why do you|what approach|how did you|what was your)\b/i;

function checkInterviewStarters(text: string): number {
    return INTERVIEW_STARTERS.test(text) ? 30 : 0;
}

// ─── Signal 6: Interview context keywords (mild boost) ───
const CONTEXT_KEYWORDS = /\b(experience|project|challenge|team|role|approach|design|implement|handle|improve|strategy|decision|leadership|conflict|failure|success|mistake|achievement|contribution|responsibility)\b/i;

function checkContextKeywords(text: string): number {
    return CONTEXT_KEYWORDS.test(text) ? 5 : 0;
}

// ─── Signal 7: Length heuristic ───
// Interview questions are typically 8-60 words
function checkLengthHeuristic(text: string): number {
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount >= 8 && wordCount <= 60) return 5;
    if (wordCount < 4) return -10; // Too short — likely just a word or filler
    return 0;
}

// ─── Signal 8: Behavioral STAR triggers ───
const STAR_TRIGGERS = /\b(tell me about a time|situation where|example of|a time when|how did you handle|how have you dealt)\b/i;

function checkSTARTriggers(text: string): number {
    return STAR_TRIGGERS.test(text) ? 20 : 0;
}

// ─── Signal 9: Negative signals (reduce score) ───
// Things that suggest it's NOT a question (e.g., the interviewer just acknowledging)
const ACKNOWLEDGMENT = /^(ok|okay|right|sure|great|good|perfect|i see|got it|thanks|thank you|alright|mm hmm|uh huh|yeah|yes|interesting|nice|absolutely|exactly|correct|yep|yup)[\.\!\,]?\s*$/i;

function checkNegativeSignals(text: string): number {
    const trimmed = text.trim();
    if (ACKNOWLEDGMENT.test(trimmed)) return -40;
    if (trimmed.split(/\s+/).length <= 2) return -20; // 1-2 word utterances are rarely questions
    return 0;
}

// ─── Main Detection Function ───

const QUESTION_THRESHOLD = 25;

/**
 * Determines if the given text is likely an interview question.
 * Designed to run on **complete utterances** (post-onSpeechEnd).
 *
 * @param text - The full utterance text to analyze
 * @param _context - Optional conversation context (unused in heuristic mode)
 * @param _mode - Detection mode (heuristic is now the default and recommended)
 * @param skipNlp - If true, skips the external NLP completeness check
 */
export async function isQuestion(
    text: string,
    _context: string[] = [],
    _mode: DetectionMode = 'heuristic',
    skipNlp: boolean = false
): Promise<DetectionResult> {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 5) {
        return { isQuestion: false, confidence: 0, signals: [] };
    }

    const signals: { name: string; score: number }[] = [
        { name: 'question_mark', score: checkQuestionMark(trimmed) },
        { name: 'interrogative_open', score: checkInterrogativeOpening(trimmed) },
        { name: 'directive_pattern', score: checkDirectivePattern(trimmed) },
        { name: 'interrogative_anywhere', score: checkInterrogativeAnywhere(trimmed) },
        { name: 'interview_starter', score: checkInterviewStarters(trimmed) },
        { name: 'context_keywords', score: checkContextKeywords(trimmed) },
        { name: 'length_heuristic', score: checkLengthHeuristic(trimmed) },
        { name: 'star_trigger', score: checkSTARTriggers(trimmed) },
        { name: 'negative_signal', score: checkNegativeSignals(trimmed) },
    ];

    const totalScore = signals.reduce((sum, s) => sum + s.score, 0);
    const activeSignals = signals.filter(s => s.score > 0).map(s => s.name);

    let isQ = totalScore >= QUESTION_THRESHOLD;
    const confidence = Math.min(Math.max(totalScore / 60, 0), 1.0);
    
    let syntacticallyComplete = true;

    // Call Tier 1 Gate (Python sidecar) if it looks like a question
    if (isQ && !skipNlp) {
        try {
            const res = await fetch('http://127.0.0.1:8178/nlp/check-completeness', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: trimmed })
            });
            if (res.ok) {
                const data = await res.json();
                syntacticallyComplete = data.is_complete;
                if (!syntacticallyComplete) {
                    console.log(`[NLP Gate] Fragment detected: "${trimmed}" Reason: ${data.reason}`);
                    // We don't necessarily clear isQ here, but we pass the flag
                    // so the caller can decide whether to speculatively fire.
                }
            }
        } catch (err) {
            console.warn('[NLP Gate] Failed to connect to Python sidecar, skipping syntactic check.', err);
        }
    }

    return {
        isQuestion: isQ,
        confidence,
        signals: activeSignals,
        syntacticallyComplete,
    };
}

/**
 * Synchronous version for use in event callbacks where async isn't needed.
 */
export function isQuestionSync(text: string): DetectionResult {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 5) {
        return { isQuestion: false, confidence: 0, signals: [] };
    }

    const signals: { name: string; score: number }[] = [
        { name: 'question_mark', score: checkQuestionMark(trimmed) },
        { name: 'interrogative_open', score: checkInterrogativeOpening(trimmed) },
        { name: 'directive_pattern', score: checkDirectivePattern(trimmed) },
        { name: 'interrogative_anywhere', score: checkInterrogativeAnywhere(trimmed) },
        { name: 'interview_starter', score: checkInterviewStarters(trimmed) },
        { name: 'context_keywords', score: checkContextKeywords(trimmed) },
        { name: 'length_heuristic', score: checkLengthHeuristic(trimmed) },
        { name: 'star_trigger', score: checkSTARTriggers(trimmed) },
        { name: 'negative_signal', score: checkNegativeSignals(trimmed) },
    ];

    const totalScore = signals.reduce((sum, s) => sum + s.score, 0);
    const activeSignals = signals.filter(s => s.score > 0).map(s => s.name);

    return {
        isQuestion: totalScore >= QUESTION_THRESHOLD,
        confidence: Math.min(Math.max(totalScore / 60, 0), 1.0),
        signals: activeSignals,
    };
}
