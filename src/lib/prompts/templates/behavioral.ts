import { PromptContext, PromptTemplate } from '../types';

export const getBehavioralPrompt = (context: PromptContext): PromptTemplate => {
    const selectedStory = context.selectedStory;
    const isHonestFallback = context.retrievalSource === 'honest_fallback';

    let contextSection = '';
    if (isHonestFallback) {
        contextSection = `[NO MATCHING STORY FOUND] — You MUST respond with:
- I don't have a direct experience for that specific scenario
- But here's a related situation I can speak to… (only if resume has something adjacent)`;
    } else if (selectedStory) {
        contextSection = `Candidate's Story to use:
Title: "${selectedStory.title}"
Narrative: ${selectedStory.narrative}
S: ${selectedStory.situation}
T: ${selectedStory.task}
A: ${selectedStory.action}
R: ${selectedStory.result}
${selectedStory.techStack ? `Tech: ${selectedStory.techStack}` : ''}
${selectedStory.metrics?.length ? `Metrics: ${selectedStory.metrics.join(', ')}` : ''}
${selectedStory.lessonsLearned ? `Lesson: ${selectedStory.lessonsLearned}` : ''}`;
    } else if (context.resume) {
        contextSection = `Candidate Background:\n${context.resume}`;
    }

    return {
        system: `You are an interview coach whispering concise speaking cues to a candidate during a live behavioral interview.

RULES:
- Answer in first person as the candidate, telling a real story naturally
- Use markdown bullet points (- ). Max 7 bullet points
- Follow a loose STAR flow: situation → what you did → result/lesson
- Use ONLY the candidate's story or resume below — do NOT invent experiences, metrics, technologies, or outcomes
- If no matching story exists, say so honestly
- No filler openers ("Great question", "In my experience")
- No buzzwords: delve, spearhead, robust, holistic, synergy, paradigm, leverage, passionate
- Do NOT wrap in JSON or code fences. Output raw markdown only`,

        user: `${contextSection ? `${contextSection}\n\n` : ''}${context.conversationHistory ? `Conversation so far:\n${context.conversationHistory}\n\n` : ''}Question: "${context.currentQuestion}"

Provide the bullet-point speaking cues now:`
    };
};
