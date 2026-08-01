import { PromptContext, PromptTemplate } from '../types';

interface HRContext extends PromptContext {
    salaryPreferences?: {
        currentSalary?: string;
        targetSalary?: string;
        negotiationStrategy?: 'deflect' | 'anchor-high' | 'market-rate';
    };
}

const SALARY_KEYWORDS = ['salary', 'compensation', 'pay', 'package', 'benefits', 'equity', 'offer', 'ctc', 'total comp'];
const RED_FLAG_KEYWORDS = ['gap', 'why did you leave', 'fired', 'terminated', 'short tenure', 'let go', 'laid off', 'unemployment'];

function detectQuestionType(question: string): 'salary' | 'red-flag' | 'general' {
    const lower = question.toLowerCase();
    if (SALARY_KEYWORDS.some(k => lower.includes(k))) return 'salary';
    if (RED_FLAG_KEYWORDS.some(k => lower.includes(k))) return 'red-flag';
    return 'general';
}

export const getHRScreeningPrompt = (context: HRContext): PromptTemplate => {
    const questionType = detectQuestionType(context.currentQuestion);
    const salaryPref = context.salaryPreferences;

    let extraInstructions = '';
    if (questionType === 'salary' && salaryPref) {
        const strategy = salaryPref.negotiationStrategy || 'deflect';
        if (strategy === 'deflect') {
            extraInstructions = `\nSALARY STRATEGY: Deflect. Suggest: "I'm focused on finding the right role and team fit. I'd love to learn more about the total compensation structure."`;
        } else if (strategy === 'anchor-high') {
            extraInstructions = `\nSALARY STRATEGY: Anchor high. Target: ${salaryPref.targetSalary || 'competitive'}. Frame as: "Based on my experience, I'm targeting [range]. Open to discussing full package."`;
        } else if (strategy === 'market-rate') {
            extraInstructions = `\nSALARY STRATEGY: Market rate. Say: "I'm looking for compensation competitive with market rates for this role and level."`;
        }
    }
    if (questionType === 'red-flag') {
        extraInstructions = `\nSENSITIVE QUESTION — frame diplomatically:
- Gaps → intentional (learning, caregiving, personal project)
- Departures → focus on what you're moving TOWARD
- Short tenures → emphasize what you learned
- Never speak negatively about previous employers`;
    }

    return {
        system: `You are an interview coach helping a candidate navigate an HR screening call.

RULES:
- Answer in first person, professional and confident tone
- Use markdown bullet points (- ). Max 5 bullet points (HR answers should be brief)
- Ground in the candidate's real background — do NOT invent
- No buzzwords: delve, spearhead, robust, holistic, synergy, paradigm, leverage, passionate
- Do NOT wrap in JSON or code fences. Output raw markdown only${extraInstructions}`,

        user: `${context.resume ? `Candidate Background:\n${context.resume}\n\n` : ''}${context.targetRole ? `Target Role: ${context.targetRole}\n` : ''}${context.company ? `Target Company: ${context.company}\n\n` : ''}${context.conversationHistory ? `Conversation so far:\n${context.conversationHistory}\n\n` : ''}HR Question: "${context.currentQuestion}"

Provide the bullet-point speaking cues now:`
    };
};

export { detectQuestionType, SALARY_KEYWORDS, RED_FLAG_KEYWORDS };
