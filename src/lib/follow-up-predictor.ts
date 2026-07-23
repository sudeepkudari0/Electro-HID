import { InterviewType } from './prompts/types';
import { Story } from '../state/profile-store';

export async function predictFollowUps(
    question: string,
    answer: string,
    interviewType: InterviewType,
    selectedStory?: Story
): Promise<string[]> {
    if (!question || !answer) return [];

    let systemPrompt = `You are an expert ${interviewType} interviewer. Based on the candidate's answer to the question, predict the 3 most likely follow-up questions you would ask to probe deeper. 
Return exactly 3 questions, one per line. Do not include numbering, bullet points, or any other introductory or concluding text.`;

    if (selectedStory) {
        systemPrompt = `You are an expert ${interviewType} interviewer. Based on the candidate's answer and the project details, generate 3 realistic, specific follow-up questions.
Focus the follow-up questions directly on the technologies, architecture, challenges, trade-offs, and mistakes from the project metadata:
- Tech Stack: ${selectedStory.techStack || 'None'}
- Architecture: ${selectedStory.architecture || 'None'}
- Challenges: ${selectedStory.challenges || 'None'}
- Trade-offs: ${selectedStory.tradeoffs || 'None'}
- Mistakes/Lessons: ${selectedStory.mistakes || 'None'}

Ensure the questions probe the candidate's actual responsibilities and decisions (e.g. if the story uses Redis, ask "Why Redis instead of Postgres?").
Return exactly 3 questions, one per line. Do not include numbering, bullet points, or any other text.`;
    }

    const prompt = `Question:\n${question}\n\nCandidate's Answer:\n${answer}`;

    try {
        const response = await window.electronAPI.llmGenerate({
            systemPrompt,
            prompt,
            temperature: 0.7,
            maxTokens: 512,
            stream: false
        });

        if (response.success && response.text) {
            // Split by newline, filter out empty lines, clean up numbers/bullets, and limit to 3
            const followUps = response.text
                .split('\n')
                .map(line => line.replace(/^(?:\d+[\.\)]|[-*•])\s*/, '').trim())
                .filter(line => line.length > 10) // Basic length check to ensure it's a sentence
                .slice(0, 3);
            
            return followUps;
        }
        
        return [];
    } catch (error) {
        console.error('Failed to predict follow-ups:', error);
        return [];
    }
}
