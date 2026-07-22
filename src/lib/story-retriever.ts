import { Story } from '../state/profile-store';
import { DetailedCategory } from './interview-classifier';

export interface RetrievalResult {
    selectedStory?: Story;
    similarityScore: number;
    chosenSource: 'story' | 'resume' | 'honest_fallback';
    classification: DetailedCategory;
    debugInfo: {
        question: string;
        classification: string;
        retrievedStories: { title: string; score: number }[];
        similarityScore: number;
        chosenStory: string;
        generationPrompt: string;
        answer?: string;
    };
}

const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'cant', 'cannot', 'could',
    'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few', 'for', 'from',
    'further', 'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell', 'hes', 'her', 'here',
    'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'ill', 'im', 'ive', 'if', 'in',
    'into', 'is', 'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt', 'my', 'myself', 'no', 'nor',
    'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
    'same', 'shant', 'shed', 'shell', 'shes', 'should', 'shouldnt', 'so', 'some', 'such', 'than', 'that', 'thats',
    'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'theres', 'these', 'they', 'theyd', 'theyll',
    'theyre', 'theyve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasnt',
    'we', 'wed', 'well', 'weve', 'were', 'werent', 'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which',
    'while', 'who', 'whos', 'whom', 'why', 'whys', 'with', 'wont', 'would', 'wouldnt', 'you', 'youd', 'youll',
    'youre', 'youve', 'your', 'yours', 'yourself', 'yourselves'
]);

function getWordTokens(text: string): string[] {
    return text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

function calculateTFSimilarity(text1: string, text2: string): number {
    const tokens1 = getWordTokens(text1);
    const tokens2 = getWordTokens(text2);
    if (tokens1.length === 0 || tokens2.length === 0) return 0;
    
    const freq1: Record<string, number> = {};
    const freq2: Record<string, number> = {};
    
    tokens1.forEach(t => freq1[t] = (freq1[t] || 0) + 1);
    tokens2.forEach(t => freq2[t] = (freq2[t] || 0) + 1);
    
    const allWords = new Set([...Object.keys(freq1), ...Object.keys(freq2)]);
    
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;
    
    allWords.forEach(w => {
        const v1 = freq1[w] || 0;
        const v2 = freq2[w] || 0;
        dotProduct += v1 * v2;
        mag1 += v1 * v1;
        mag2 += v2 * v2;
    });
    
    if (mag1 === 0 || mag2 === 0) return 0;
    return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

export function retrieveStory(
    query: string,
    category: DetailedCategory,
    stories: Story[],
    recentStoryIds: string[],
    resumeText?: string
): RetrievalResult {
    const categoryLower = category.toLowerCase();
    
    // Default debug logging output structure
    const debugInfo: RetrievalResult['debugInfo'] = {
        question: query,
        classification: category,
        retrievedStories: [],
        similarityScore: 0,
        chosenStory: 'None',
        generationPrompt: ''
    };

    if (!stories || stories.length === 0) {
        const chosenSource = (resumeText && resumeText.trim().length > 100) ? 'resume' : 'honest_fallback';
        return {
            similarityScore: 0,
            chosenSource,
            classification: category,
            debugInfo: {
                ...debugInfo,
                chosenStory: chosenSource === 'resume' ? 'Resume Context' : 'Honest Fallback'
            }
        };
    }

    // Score all stories based on multiple matching factors
    const scoredStories = stories.map(story => {
        // Build rich search document representing the story content
        const searchDoc = [
            story.title,
            story.situation,
            story.task,
            story.action,
            story.result,
            story.embeddingText || '',
            story.narrative || '',
            story.techStack || '',
            story.tags.join(' '),
            story.keywords || ''
        ].join(' ');
        
        let score = calculateTFSimilarity(query, searchDoc);
        
        // 1. Tech overlap boost (+0.15 per tech term matching the query, max 0.45)
        if (story.techStack) {
            const techs = story.techStack.split(',').map(t => t.trim().toLowerCase());
            let techMatchCount = 0;
            techs.forEach(tech => {
                if (tech && query.toLowerCase().includes(tech)) {
                    techMatchCount++;
                }
            });
            score += Math.min(techMatchCount * 0.15, 0.45);
        }
        
        // 2. Project/Title match (+0.1 if words in the title match query)
        const titleTokens = getWordTokens(story.title);
        let titleMatchCount = 0;
        titleTokens.forEach(token => {
            if (query.toLowerCase().includes(token)) {
                titleMatchCount++;
            }
        });
        score += Math.min(titleMatchCount * 0.1, 0.3);
        
        // 3. Category matching boost (+0.25 if category matches story tags)
        let matchesCategoryTag = false;
        story.tags.forEach(tag => {
            const tagLower = tag.toLowerCase();
            if (categoryLower === tagLower || 
                (categoryLower === 'project deep dive' && tagLower === 'technical') ||
                (categoryLower === 'ownership' && tagLower === 'leadership')) {
                matchesCategoryTag = true;
            }
        });
        if (matchesCategoryTag) {
            score += 0.25;
        }

        // Additional behavior query indicators (+0.1 boost)
        story.tags.forEach(tag => {
            if (query.toLowerCase().includes(tag.toLowerCase())) {
                score += 0.1;
            }
        });
        
        // 4. Recent usage penalty (-0.3 to prevent cycling the same story repeatedly)
        if (recentStoryIds && recentStoryIds.includes(story.id)) {
            score -= 0.3;
        }
        
        return { story, score };
    });

    // Sort stories descending
    scoredStories.sort((a, b) => b.score - a.score);
    
    debugInfo.retrievedStories = scoredStories.map(s => ({
        title: s.story.title,
        score: parseFloat(s.score.toFixed(3))
    }));

    const bestMatch = scoredStories[0];
    const confidenceThreshold = 0.35; // Similarity score threshold
    
    let chosenSource: 'story' | 'resume' | 'honest_fallback' = 'story';
    let selectedStory: Story | undefined = undefined;
    let finalScore = 0;
    
    if (bestMatch && bestMatch.score >= confidenceThreshold) {
        chosenSource = 'story';
        selectedStory = bestMatch.story;
        finalScore = parseFloat(bestMatch.score.toFixed(3));
    } else {
        // Check if resume context is available as fallback
        if (resumeText && resumeText.trim().length > 100) {
            chosenSource = 'resume';
            finalScore = bestMatch ? parseFloat(bestMatch.score.toFixed(3)) : 0;
        } else {
            chosenSource = 'honest_fallback';
            finalScore = 0;
        }
    }
    
    debugInfo.similarityScore = finalScore;
    debugInfo.chosenStory = selectedStory ? selectedStory.title : (chosenSource === 'resume' ? 'Resume Context' : 'Honest Fallback');

    return {
        selectedStory,
        similarityScore: finalScore,
        chosenSource,
        classification: category,
        debugInfo
    };
}
