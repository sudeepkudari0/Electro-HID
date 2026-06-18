import React, { useEffect, useState } from 'react';
import { usePracticeStore } from '../../state/practice-store';
import { useSessionStore } from '../../state/session-store';
import { useLLM } from '../../hooks/useLLM';
import { getInterviewerPrompt } from '../../lib/prompts/templates/interviewer';
import { getEvaluatorPrompt } from '../../lib/prompts/templates/evaluator';
import { useProfile } from '../../hooks/useProfile';
import { useTTS } from '../../hooks/useTTS';

export const PracticeSession: React.FC = () => {
    const { 
        practiceConfig, 
        currentQuestionIndex, 
        practiceQuestions, 
        evaluations,
        setPracticeQuestions,
        setCurrentQuestionIndex,
        addEvaluation,
        updateQuestionAnswer,
        endPractice
    } = usePracticeStore();

    const { conversation, isRecording } = useSessionStore();
    const { profile } = useProfile();
    const { generateFromPromptTemplate } = useLLM();
    const { speak, stop, isPlaying } = useTTS();

    const [isGeneratingQuestion, setIsGeneratingQuestion] = useState(false);
    const [isEvaluating, setIsEvaluating] = useState(false);
    const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());

    // Initialize or generate question
    useEffect(() => {
        if (!practiceConfig) return;

        const generateNextQuestion = async () => {
            if (practiceQuestions.length > currentQuestionIndex) return; // already generated
            if (practiceQuestions.length >= practiceConfig.questionCount) return; // done

            setIsGeneratingQuestion(true);
            try {
                const previousQuestions = practiceQuestions.map(q => q.question);
                const prompt = getInterviewerPrompt({
                    interviewType: practiceConfig.interviewType,
                    role: practiceConfig.role,
                    company: practiceConfig.company,
                    resume: profile?.resume,
                    jobDescription: practiceConfig.jobDescription || profile?.jobDescription,
                    previousQuestions,
                    difficultyLevel: Math.min(5, 1 + Math.floor(currentQuestionIndex / 2)),
                });

                const questionText = await generateFromPromptTemplate(prompt);
                
                const newQuestion = {
                    id: Date.now().toString(),
                    question: questionText.trim()
                };

                setPracticeQuestions([...practiceQuestions, newQuestion]);
                setQuestionStartTime(Date.now());
                speak(newQuestion.question);

            } catch (err) {
                console.error("Failed to generate question", err);
            } finally {
                setIsGeneratingQuestion(false);
            }
        };

        generateNextQuestion();
    }, [currentQuestionIndex, practiceConfig, practiceQuestions, profile, speak]);

    const currentQuestion = practiceQuestions[currentQuestionIndex];
    const currentEvaluation = evaluations.find(e => e.questionId === currentQuestion?.id);

    const handleNext = async () => {
        stop(); // Stop any currently playing audio

        if (isEvaluating || isGeneratingQuestion) return;

        if (currentEvaluation) {
            // Already evaluated, move to next
            if (currentQuestionIndex >= practiceConfig!.questionCount - 1) {
                endPractice(); // End will just transition state to results
            } else {
                setCurrentQuestionIndex(currentQuestionIndex + 1);
            }
            return;
        }

        // Evaluate answer
        setIsEvaluating(true);
        try {
            // Extract user answer from conversation since question started
            const answerBlocks = conversation.filter(b => 
                b.speaker === 'user' && b.timestamp.getTime() >= questionStartTime
            );
            const answerText = answerBlocks.map(b => b.text).join(' ').trim();
            
            updateQuestionAnswer(currentQuestion.id, answerText);

            const prompt = getEvaluatorPrompt({
                interviewType: practiceConfig!.interviewType,
                role: practiceConfig!.role,
                question: currentQuestion.question,
                answer: answerText,
            });

            const jsonResponse = await generateFromPromptTemplate(prompt, undefined, 'json');
            
            // Clean up potentially malformed JSON (e.g. if the model wrapped it in markdown)
            const cleanJson = jsonResponse.replace(/```json\n?|\n?```/g, '').trim();
            const evaluation = JSON.parse(cleanJson);

            addEvaluation({
                questionId: currentQuestion.id,
                score: evaluation.score,
                strengths: evaluation.strengths,
                improvements: evaluation.improvements,
                modelAnswer: evaluation.modelAnswer
            });

        } catch (err) {
            console.error("Evaluation failed", err);
        } finally {
            setIsEvaluating(false);
        }
    };

    if (!practiceConfig) return null;

    return (
        <div className="flex flex-col h-full bg-slate-900 text-white">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-slate-900 flex justify-between items-center shrink-0">
                <div>
                    <h2 className="text-lg font-semibold">Mock Interview: {practiceConfig.role}</h2>
                    <p className="text-sm text-slate-400">
                        Question {currentQuestionIndex + 1} of {practiceConfig.questionCount} • {practiceConfig.interviewType}
                    </p>
                </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {isGeneratingQuestion ? (
                    <div className="animate-pulse flex space-x-4">
                        <div className="flex-1 space-y-4 py-1">
                            <div className="h-4 bg-slate-700 rounded w-3/4"></div>
                            <div className="h-4 bg-slate-700 rounded w-1/2"></div>
                        </div>
                    </div>
                ) : currentQuestion ? (
                    <div className="space-y-6">
                        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
                            <div className="flex items-center space-x-2 mb-2">
                                <h3 className="text-sm font-medium text-blue-400">Interviewer</h3>
                                {isPlaying && (
                                    <span className="flex items-center space-x-1">
                                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                    </span>
                                )}
                            </div>
                            <p className="text-lg">{currentQuestion.question}</p>
                        </div>

                        {!currentEvaluation && (
                            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-sm font-medium text-emerald-400">Your Answer</h3>
                                    <div className="flex items-center space-x-2 text-xs">
                                        <span className={isRecording ? 'text-red-400 animate-pulse' : 'text-slate-400'}>
                                            {isRecording ? '● Recording...' : '⏸ Paused'}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-slate-300 min-h-[100px]">
                                    {conversation
                                        .filter(b => b.speaker === 'user' && b.timestamp.getTime() >= questionStartTime)
                                        .map(b => b.text)
                                        .join(' ') || (
                                        <span className="text-slate-500 italic">Speak your answer clearly...</span>
                                    )}
                                </div>
                            </div>
                        )}

                        {currentEvaluation && (
                            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                                <div className="bg-slate-700 px-4 py-2 border-b border-slate-600 flex justify-between items-center">
                                    <h3 className="font-medium text-white">AI Evaluation</h3>
                                    <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded">
                                        Score: {currentEvaluation.score}/10
                                    </span>
                                </div>
                                <div className="p-4 space-y-4 text-sm">
                                    <div>
                                        <h4 className="text-emerald-400 font-medium mb-1">Strengths</h4>
                                        <ul className="list-disc pl-5 space-y-1 text-slate-300">
                                            {currentEvaluation.strengths.map((s, i) => <li key={i}>{s}</li>)}
                                        </ul>
                                    </div>
                                    <div>
                                        <h4 className="text-orange-400 font-medium mb-1">Areas for Improvement</h4>
                                        <ul className="list-disc pl-5 space-y-1 text-slate-300">
                                            {currentEvaluation.improvements.map((s, i) => <li key={i}>{s}</li>)}
                                        </ul>
                                    </div>
                                    <div className="pt-2 border-t border-slate-700">
                                        <h4 className="text-blue-400 font-medium mb-1">Model Answer</h4>
                                        <p className="text-slate-300 italic">"{currentEvaluation.modelAnswer}"</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}
            </div>

            {/* Footer / Controls */}
            <div className="p-4 border-t border-slate-800 bg-slate-900 shrink-0">
                <button
                    onClick={handleNext}
                    disabled={isEvaluating || isGeneratingQuestion || !currentQuestion}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
                >
                    {isEvaluating ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Evaluating Answer...
                        </>
                    ) : currentEvaluation ? (
                        currentQuestionIndex >= practiceConfig.questionCount - 1 ? 'Finish Practice' : 'Next Question'
                    ) : (
                        'Submit Answer'
                    )}
                </button>
            </div>
        </div>
    );
};
