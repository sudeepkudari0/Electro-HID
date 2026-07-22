import React, { useState } from 'react';
import { useProfile } from '../../hooks/useProfile';
import { type Story } from '../../state/profile-store';
import { useLLM } from '../../hooks/useLLM';
import { Plus, Trash2, Edit2, ChevronDown, ChevronRight, Sparkles, Loader2 } from 'lucide-react';

const STORY_TAGS = ['leadership', 'conflict', 'failure', 'teamwork', 'innovation', 'initiative', 'growth', 'technical', 'customer', 'deadline'];

// Robust JSON parser to extract JSON blocks from LLM responses containing conversational text or smart quotes
function extractJsonFromString(str: string): any {
    const firstBracket = str.indexOf('[');
    const firstBrace = str.indexOf('{');
    
    let startIndex = -1;
    let endIndex = -1;
    
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
        startIndex = firstBracket;
        endIndex = str.lastIndexOf(']');
    } else if (firstBrace !== -1) {
        startIndex = firstBrace;
        endIndex = str.lastIndexOf('}');
    }
    
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const jsonStr = str.substring(startIndex, endIndex + 1);
        // Normalize smart/curly double quotes
        const normalized = jsonStr.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
        return JSON.parse(normalized);
    }
    
    throw new Error("Could not locate valid JSON braces or brackets in response. Raw response: " + str.substring(0, 150) + "...");
}

interface StoryFormData {
    title: string;
    situation: string;
    task: string;
    action: string;
    result: string;
    tags: string[];
    metrics: string[];
}

const emptyForm: StoryFormData = {
    title: '', situation: '', task: '', action: '', result: '', tags: [], metrics: [],
};

export const StoryBank: React.FC = () => {
    const { profile, saveProfile } = useProfile();
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<StoryFormData>(emptyForm);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [enrichingStoryId, setEnrichingStoryId] = useState<string | null>(null);
    const [metricsInput, setMetricsInput] = useState('');

    const stories = profile.stories || [];

    const handleSave = async () => {
        setIsGenerating(true);
        try {
            // STAR -> LLM -> Narrative -> Embedding Text -> Store
            const systemPrompt = `You are an expert career coach. Analyze the STAR fields of the candidate's interview story and generate the following fields:
1. narrative: A natural 150-250 word first-person interview answer telling this story. It should sound like a real person talking during a live interview (e.g. "One production feature I personally owned end-to-end was..."). Never use bold headers or bullet points. It must flow naturally.
2. techStack: A brief comma-separated list of technologies used in the story.
3. architecture: A brief 1-sentence description of the system architecture or components involved.
4. challenges: A brief 1-2 sentence description of the primary engineering/operational challenges.
5. tradeoffs: A brief 1-2 sentence description of technical trade-offs made.
6. mistakes: A brief 1-sentence description of mistakes or code regressions.
7. lessonsLearned: A brief 1-sentence description of key technical takeaways.
8. keywords: Comma-separated list of key technical and domain keywords.
9. searchSummary: A 1-sentence search summary.
10. embeddingText: A 2-3 sentence description only used for search embeddings. It MUST contain the technologies, architecture, ownership level, keywords, problems solved, and domain.

Return ONLY a valid JSON object with these exact keys: "narrative", "techStack", "architecture", "challenges", "tradeoffs", "mistakes", "lessonsLearned", "keywords", "searchSummary", "embeddingText".`;

            const userPrompt = `STAR Story:
Title: ${form.title}
Situation: ${form.situation}
Task: ${form.task}
Action: ${form.action}
Result: ${form.result}
Metrics: ${form.metrics.join(', ')}
Tags: ${form.tags.join(', ')}`;

            // Call Electron IPC directly with high maxTokens and low temperature for JSON reliability
            const response = await window.electronAPI.llmGenerate({
                systemPrompt,
                prompt: userPrompt,
                temperature: 0.1,
                maxTokens: 2048,
                format: 'json'
            });

            if (!response.success || !response.text) {
                throw new Error(response.error || 'Failed to generate details from LLM');
            }

            const generated = extractJsonFromString(response.text);

            const newStory: Story = {
                id: editingId || Date.now().toString(),
                ...form,
                narrative: generated.narrative || '',
                techStack: generated.techStack || '',
                architecture: generated.architecture || '',
                challenges: generated.challenges || '',
                tradeoffs: generated.tradeoffs || '',
                mistakes: generated.mistakes || '',
                lessonsLearned: generated.lessonsLearned || '',
                keywords: generated.keywords || '',
                searchSummary: generated.searchSummary || '',
                embeddingText: generated.embeddingText || '',
            };

            if (editingId) {
                await saveProfile({ stories: stories.map(s => s.id === editingId ? newStory : s) });
            } else {
                await saveProfile({ stories: [...stories, newStory] });
            }
        } catch (err) {
            console.error('Failed to auto-generate narrative details. Saving baseline STAR fields.', err);
            // Fallback: save what we have from the form
            const newStory: Story = {
                id: editingId || Date.now().toString(),
                ...form,
                narrative: stories.find(s => s.id === editingId)?.narrative || '',
                techStack: stories.find(s => s.id === editingId)?.techStack || '',
                architecture: stories.find(s => s.id === editingId)?.architecture || '',
                challenges: stories.find(s => s.id === editingId)?.challenges || '',
                tradeoffs: stories.find(s => s.id === editingId)?.tradeoffs || '',
                mistakes: stories.find(s => s.id === editingId)?.mistakes || '',
                lessonsLearned: stories.find(s => s.id === editingId)?.lessonsLearned || '',
                keywords: stories.find(s => s.id === editingId)?.keywords || '',
                searchSummary: stories.find(s => s.id === editingId)?.searchSummary || '',
                embeddingText: stories.find(s => s.id === editingId)?.embeddingText || '',
            };
            if (editingId) {
                await saveProfile({ stories: stories.map(s => s.id === editingId ? newStory : s) });
            } else {
                await saveProfile({ stories: [...stories, newStory] });
            }
        } finally {
            setIsGenerating(false);
            setForm(emptyForm);
            setIsAdding(false);
            setEditingId(null);
        }
    };

    const handleEnrichStory = async (story: Story) => {
        setEnrichingStoryId(story.id);
        try {
            const systemPrompt = `You are an expert career coach. Analyze the STAR fields of the candidate's interview story and generate the following fields:
1. narrative: A natural 150-250 word first-person interview answer telling this story. It should sound like a real person talking during a live interview (e.g. "One production feature I personally owned end-to-end was..."). Never use bold headers or bullet points. It must flow naturally.
2. techStack: A brief comma-separated list of technologies used in the story.
3. architecture: A brief 1-sentence description of the system architecture or components involved.
4. challenges: A brief 1-2 sentence description of the primary engineering/operational challenges.
5. tradeoffs: A brief 1-2 sentence description of technical trade-offs made.
6. mistakes: A brief 1-sentence description of mistakes or code regressions.
7. lessonsLearned: A brief 1-sentence description of key technical takeaways.
8. keywords: Comma-separated list of key technical and domain keywords.
9. searchSummary: A 1-sentence search summary.
10. embeddingText: A 2-3 sentence description only used for search embeddings. It MUST contain the technologies, architecture, ownership level, keywords, problems solved, and domain.

Return ONLY a valid JSON object with these exact keys: "narrative", "techStack", "architecture", "challenges", "tradeoffs", "mistakes", "lessonsLearned", "keywords", "searchSummary", "embeddingText".`;

            const userPrompt = `STAR Story:
Title: ${story.title}
Situation: ${story.situation}
Task: ${story.task}
Action: ${story.action}
Result: ${story.result}
Metrics: ${story.metrics?.join(', ') || ''}
Tags: ${story.tags?.join(', ') || ''}`;

            const response = await window.electronAPI.llmGenerate({
                systemPrompt,
                prompt: userPrompt,
                temperature: 0.1,
                maxTokens: 2048,
                format: 'json'
            });

            if (!response.success || !response.text) {
                throw new Error(response.error || 'Failed to generate details from LLM');
            }

            const generated = extractJsonFromString(response.text);

            const enrichedStory: Story = {
                ...story,
                narrative: generated.narrative || '',
                techStack: generated.techStack || '',
                architecture: generated.architecture || '',
                challenges: generated.challenges || '',
                tradeoffs: generated.tradeoffs || '',
                mistakes: generated.mistakes || '',
                lessonsLearned: generated.lessonsLearned || '',
                keywords: generated.keywords || '',
                searchSummary: generated.searchSummary || '',
                embeddingText: generated.embeddingText || '',
            };

            await saveProfile({ stories: stories.map(s => s.id === story.id ? enrichedStory : s) });
        } catch (err) {
            console.error('Failed to enrich story with narrative metadata details:', err);
        } finally {
            setEnrichingStoryId(null);
        }
    };

    const handleEdit = (story: Story) => {
        setForm({
            title: story.title,
            situation: story.situation,
            task: story.task,
            action: story.action,
            result: story.result,
            tags: story.tags,
            metrics: story.metrics,
        });
        setEditingId(story.id);
        setIsAdding(true);
    };

    const handleDelete = async (id: string) => {
        await saveProfile({ stories: stories.filter(s => s.id !== id) });
    };

    const toggleTag = (tag: string) => {
        setForm(prev => ({
            ...prev,
            tags: prev.tags.includes(tag) ? prev.tags.filter(t => t !== tag) : [...prev.tags, tag],
        }));
    };

    const addMetric = () => {
        if (metricsInput.trim()) {
            setForm(prev => ({ ...prev, metrics: [...prev.metrics, metricsInput.trim()] }));
            setMetricsInput('');
        }
    };

    const removeMetric = (index: number) => {
        setForm(prev => ({ ...prev, metrics: prev.metrics.filter((_, i) => i !== index) }));
    };

    const handleAutoGenerate = async () => {
        if (!profile.resume) return;
        setIsGenerating(true);
        try {
            const systemPrompt = `You are a career coach. Extract 3-5 potential STAR stories from the candidate's resume.
For each story, provide:
- title: A short descriptive title
- situation: The context/background
- task: What was the candidate's responsibility
- action: What specific actions they took
- result: The outcome with metrics if available
- tags: Relevant tags from: ${STORY_TAGS.join(', ')}
- metrics: Any quantifiable achievements
- narrative: A natural 150-250 word first-person interview answer telling this story. It should sound like a real person talking during a live interview.
- techStack: A brief comma-separated list of technologies used in the story.
- architecture: A brief 1-sentence description of the system architecture or components involved.
- challenges: A brief 1-2 sentence description of the primary engineering/operational challenges.
- tradeoffs: A brief 1-2 sentence description of technical trade-offs made.
- mistakes: A brief 1-sentence description of mistakes or code regressions.
- lessonsLearned: A brief 1-sentence description of key technical takeaways.
- keywords: Comma-separated list of key technical and domain keywords.
- searchSummary: A 1-sentence search summary.
- embeddingText: A 2-3 sentence description only used for search embeddings. It MUST contain the technologies, architecture, ownership level, keywords, problems solved, and domain.

Return as a JSON array of objects with these exact fields.`;

            const userPrompt = `Extract STAR stories from this resume:\n\n${profile.resume}`;

            const response = await window.electronAPI.llmGenerate({
                systemPrompt,
                prompt: userPrompt,
                temperature: 0.2,
                maxTokens: 3000,
                format: 'json'
            });

            if (!response.success || !response.text) {
                throw new Error(response.error || 'Failed to auto-generate stories from resume');
            }

            const generated = extractJsonFromString(response.text);

            if (Array.isArray(generated)) {
                const newStories: Story[] = generated.map((s: any, i: number) => ({
                    id: `auto-${Date.now()}-${i}`,
                    title: s.title || `Story ${i + 1}`,
                    situation: s.situation || '',
                    task: s.task || '',
                    action: s.action || '',
                    result: s.result || '',
                    tags: Array.isArray(s.tags) ? s.tags : [],
                    metrics: Array.isArray(s.metrics) ? s.metrics : [],
                    narrative: s.narrative || '',
                    techStack: s.techStack || '',
                    architecture: s.architecture || '',
                    challenges: s.challenges || '',
                    tradeoffs: s.tradeoffs || '',
                    mistakes: s.mistakes || '',
                    lessonsLearned: s.lessonsLearned || '',
                    keywords: s.keywords || '',
                    searchSummary: s.searchSummary || '',
                    embeddingText: s.embeddingText || '',
                }));
                await saveProfile({ stories: [...stories, ...newStories] });
            }
        } catch (err) {
            console.error('Failed to auto-generate stories:', err);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Story Bank ({stories.length})</h3>
                <div className="flex items-center gap-2">
                    {profile.resume && (
                        <button
                            onClick={handleAutoGenerate}
                            disabled={isGenerating || !!enrichingStoryId}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 transition-colors disabled:opacity-50"
                        >
                            {isGenerating && !enrichingStoryId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            Auto-generate
                        </button>
                    )}
                    <button
                        onClick={() => { setIsAdding(true); setForm(emptyForm); setEditingId(null); }}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                    >
                        <Plus className="w-3 h-3" /> Add Story
                    </button>
                </div>
            </div>

            {/* Story Form */}
            {isAdding && (
                <div className="bg-zinc-800/80 rounded-lg p-3 border border-zinc-700 space-y-3">
                    <input
                        value={form.title}
                        onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                        placeholder="Story Title (e.g., Led cross-team migration)"
                        className="w-full bg-zinc-900 text-white text-sm rounded px-3 py-2 border border-zinc-700 focus:border-blue-500 outline-none"
                    />

                    {['situation', 'task', 'action', 'result'].map(field => (
                        <div key={field}>
                            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">
                                {field.charAt(0).toUpperCase() + field.slice(1)}
                            </label>
                            <textarea
                                value={(form as any)[field]}
                                onChange={e => setForm(prev => ({ ...prev, [field]: e.target.value }))}
                                placeholder={`Describe the ${field}...`}
                                rows={2}
                                className="w-full bg-zinc-900 text-white text-xs rounded px-3 py-2 border border-zinc-700 focus:border-blue-500 outline-none resize-none"
                            />
                        </div>
                    ))}

                    {/* Tags */}
                    <div>
                        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Tags</label>
                        <div className="flex flex-wrap gap-1.5">
                            {STORY_TAGS.map(tag => (
                                <button
                                    key={tag}
                                    type="button"
                                    onClick={() => toggleTag(tag)}
                                    className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                                        form.tags.includes(tag)
                                            ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50'
                                            : 'bg-zinc-700 text-zinc-400 border border-transparent hover:text-zinc-200'
                                    }`}
                                >
                                    {tag}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Metrics */}
                    <div>
                        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Metrics</label>
                        <div className="flex gap-2">
                            <input
                                value={metricsInput}
                                onChange={e => setMetricsInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addMetric())}
                                placeholder="e.g., 20% revenue increase"
                                className="flex-1 bg-zinc-900 text-white text-xs rounded px-3 py-1.5 border border-zinc-700 focus:border-blue-500 outline-none"
                            />
                            <button type="button" onClick={addMetric} className="text-xs text-emerald-400 hover:text-emerald-300">Add</button>
                        </div>
                        {form.metrics.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {form.metrics.map((m, i) => (
                                    <span key={i} className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                                        {m}
                                        <button type="button" onClick={() => removeMetric(i)} className="hover:text-red-400">&times;</button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={!form.title || isGenerating}
                            className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded transition-colors disabled:opacity-50 font-medium"
                        >
                            {isGenerating && <Loader2 className="w-3 h-3 animate-spin" />}
                            {editingId ? 'Update' : 'Save'} Story & Generate Narrative
                        </button>
                        <button
                            type="button"
                            onClick={() => { setIsAdding(false); setEditingId(null); }}
                            className="text-xs text-zinc-400 hover:text-white px-4 py-1.5 rounded transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Story List */}
            {stories.length === 0 && !isAdding ? (
                <p className="text-xs text-zinc-500 italic">No stories yet. Add career stories for better behavioral answers.</p>
            ) : (
                <div className="space-y-2">
                    {stories.map(story => (
                        <div key={story.id} className="bg-zinc-800/50 rounded-lg border border-zinc-700/50 overflow-hidden">
                            <button
                                onClick={() => setExpandedId(expandedId === story.id ? null : story.id)}
                                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-700/30 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    {expandedId === story.id ? <ChevronDown className="w-3 h-3 text-zinc-400" /> : <ChevronRight className="w-3 h-3 text-zinc-400" />}
                                    <span className="text-sm font-medium text-white">{story.title}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    {story.tags.slice(0, 3).map(tag => (
                                        <span key={tag} className="text-[9px] bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">{tag}</span>
                                    ))}
                                </div>
                            </button>

                            {expandedId === story.id && (
                                <div className="px-3 pb-3 space-y-2.5 text-xs text-zinc-300 border-t border-zinc-700/50 pt-2">
                                    <div className="space-y-1">
                                        <div><span className="text-blue-400 font-medium">S:</span> {story.situation}</div>
                                        <div><span className="text-emerald-400 font-medium">T:</span> {story.task}</div>
                                        <div><span className="text-amber-400 font-medium">A:</span> {story.action}</div>
                                        <div><span className="text-purple-400 font-medium">R:</span> {story.result}</div>
                                    </div>
                                    {story.metrics && story.metrics.length > 0 && (
                                        <div className="flex flex-wrap gap-1 pt-1">
                                            {story.metrics.map((m, i) => (
                                                <span key={i} className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">{m}</span>
                                            ))}
                                        </div>
                                    )}

                                    {story.narrative ? (
                                        <div className="mt-2 bg-zinc-900/60 p-2.5 rounded border border-zinc-700/30">
                                            <div className="text-[10px] text-indigo-400 font-semibold mb-1 uppercase tracking-wider font-sans">Generated Narrative Answer</div>
                                            <p className="italic text-zinc-200 text-xs leading-relaxed select-text font-sans">"{story.narrative}"</p>
                                        </div>
                                    ) : (
                                        <div className="mt-2">
                                            <button
                                                type="button"
                                                onClick={() => handleEnrichStory(story)}
                                                disabled={!!enrichingStoryId}
                                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 transition-colors disabled:opacity-50 font-medium"
                                            >
                                                {enrichingStoryId === story.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                                {enrichingStoryId === story.id ? 'Generating Narrative...' : '✨ Generate Narrative & Tech Details'}
                                            </button>
                                        </div>
                                    )}

                                    {story.narrative && (
                                        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-zinc-700/30 select-text font-sans">
                                            {story.techStack && (
                                                <div><span className="text-indigo-300 font-semibold uppercase text-[9px] tracking-wider block">Tech Stack:</span> <span className="text-zinc-300">{story.techStack}</span></div>
                                            )}
                                            {story.architecture && (
                                                <div><span className="text-indigo-300 font-semibold uppercase text-[9px] tracking-wider block">Architecture:</span> <span className="text-zinc-300">{story.architecture}</span></div>
                                            )}
                                            {story.challenges && (
                                                <div><span className="text-indigo-300 font-semibold uppercase text-[9px] tracking-wider block">Challenges:</span> <span className="text-zinc-300">{story.challenges}</span></div>
                                            )}
                                            {story.tradeoffs && (
                                                <div><span className="text-indigo-300 font-semibold uppercase text-[9px] tracking-wider block">Trade-offs:</span> <span className="text-zinc-300">{story.tradeoffs}</span></div>
                                            )}
                                            {story.mistakes && (
                                                <div><span className="text-indigo-300 font-semibold uppercase text-[9px] tracking-wider block">Mistakes:</span> <span className="text-zinc-300">{story.mistakes}</span></div>
                                            )}
                                            {story.lessonsLearned && (
                                                <div><span className="text-indigo-300 font-semibold uppercase text-[9px] tracking-wider block">Lessons Learned:</span> <span className="text-zinc-300">{story.lessonsLearned}</span></div>
                                            )}
                                            {story.keywords && (
                                                <div className="col-span-2"><span className="text-indigo-300 font-semibold uppercase text-[9px] tracking-wider block">Keywords:</span> <span className="text-zinc-350">{story.keywords}</span></div>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex gap-2 pt-2 border-t border-zinc-700/30">
                                        <button onClick={() => handleEdit(story)} className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                                            <Edit2 className="w-3 h-3" /> Edit
                                        </button>
                                        <button onClick={() => handleDelete(story.id)} className="text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1">
                                            <Trash2 className="w-3 h-3" /> Delete
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
