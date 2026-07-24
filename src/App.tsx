import { useCallback, useRef, useEffect, useState } from "react";
import { FloatingWidget } from "./components/FloatingWidget/FloatingWidget";
import { RegionSelector } from "./components/RegionSelector/RegionSelector";
import { useWhisper } from "./hooks/useWhisper";
import {
  useMixedAudioRecorder,
  SpeakerSource,
} from "./hooks/useMixedAudioRecorder";
import { useLLM } from "./hooks/useLLM";
import { useProfile } from "./hooks/useProfile";
import { isQuestion } from "./lib/question-detector";
import { classifyQuestion, classifyDetailedQuestion } from "./lib/interview-classifier";
import { retrieveStory } from "./lib/story-retriever";
import { predictFollowUps } from "./lib/follow-up-predictor";
import { getPromptTemplate } from "./lib/prompts";
import { PromptContext } from "./lib/prompts/types";
import { analyzeDelivery } from "./lib/delivery-analyzer";
import { getCodeAnalysisPrompt } from "./lib/prompts/templates/code-analysis";
import { TimestampDeduplicator } from "./lib/timestamp-deduplicator";
import { filterHallucinations } from "./lib/hallucination-filter";
import { EchoSuppressor } from "./lib/echo-suppressor";
import {
  useSessionStore,
  useAnswerStore,
  useUIStore,
  usePracticeStore,
} from "./state";
import type { ChatBlock, Answer } from "./state";

function App(): JSX.Element {
  // ─── Zustand stores ───
  const {
    conversation,
    isRecording,
    sessionTime,
    setConversation,
    setIsRecording,
    setSessionTime,
    clearTranscript,
  } = useSessionStore();

  const {
    answers,
    isGenerating,
    candidateQuestions,
    detectedQuestions,
    expandedQuestionId,
    addAnswer,
    updateAnswer,
    addCandidateQuestion,
    removeCandidateQuestion,
    clearCandidateQuestions,
    setCandidateStatus,
    updateCandidateAnswer,
    clearDetectedQuestions,
  } = useAnswerStore();

  const {
    isExpanded,
    isChatOpen,
    isHistoryOpen,
    isPracticeOpen,
    isCapturing,
    isCodeMode,
    useBulletPoints,
    isTeleprompterMode,
    toggleExpanded,
    setExpanded,
    toggleChat,
    toggleHistory,
    togglePractice,
    setCapturing,
    toggleTeleprompterMode,
  } = useUIStore();

  // ─── App-level state ───
  const [autoDetectionEnabled, setAutoDetectionEnabled] = useState(true);
  const [sttEngine, setSttEngine] = useState("Whisper.cpp");
  const [sttModel, setSttModel] = useState("");

  // Load preferences from settings on mount
  useEffect(() => {
    window.electronAPI.getSettings().then((res: any) => {
      if (res.success && res.settings) {
        const mode = res.settings.questionDetectionMode || "heuristic";
        setAutoDetectionEnabled(mode !== "manual");

        // Set STT engine display name and model
        const engine = res.settings.sttEngine || "whisper";
        if (engine === "deepgram") {
          setSttEngine("Deepgram");
          setSttModel(res.settings.deepgramModel || "nova-3");
        } else if (engine === "moonshine") {
          setSttEngine("Moonshine");
          setSttModel(res.settings.moonshineModel || "MEDIUM_STREAMING");
        } else {
          setSttEngine("Whisper.cpp");
          setSttModel(res.settings.whisperModel || "small.en");
        }

        autoAnswerConfidenceThresholdRef.current = res.settings.autoAnswerConfidenceThreshold ?? 0.8;
        useUIStore.getState().setSafeCursorMode(res.settings.safeCursorMode !== false);
      }
    });
  }, []);

  // Listen for settings updates from the main process
  useEffect(() => {
    if (window.electronAPI?.onSettingsUpdated) {
      return window.electronAPI.onSettingsUpdated((updatedSettings) => {
        if (updatedSettings) {
          const mode = updatedSettings.questionDetectionMode || "heuristic";
          setAutoDetectionEnabled(mode !== "manual");

          const engine = updatedSettings.sttEngine || "whisper";
          if (engine === "deepgram") {
            setSttEngine("Deepgram");
            setSttModel(updatedSettings.deepgramModel || "nova-3");
          } else if (engine === "moonshine") {
            setSttEngine("Moonshine");
            setSttModel(updatedSettings.moonshineModel || "MEDIUM_STREAMING");
          } else {
            setSttEngine("Whisper.cpp");
            setSttModel(updatedSettings.whisperModel || "small.en");
          }

          autoAnswerConfidenceThresholdRef.current = updatedSettings.autoAnswerConfidenceThreshold ?? 0.8;
          useUIStore.getState().setSafeCursorMode(updatedSettings.safeCursorMode !== false);
        }
      });
    }
  }, []);

  // Listen for prepJob settings from Dashboard window on mount
  useEffect(() => {
    try {
      const prepJobStr = localStorage.getItem("prepJob");
      if (prepJobStr) {
        const prepJob = JSON.parse(prepJobStr);
        localStorage.removeItem("prepJob");

        // 1. Initialize practice store configuration
        usePracticeStore.getState().startPractice({
          interviewType: "general",
          role: prepJob.role || "Software Engineer",
          company: prepJob.company || "",
          questionCount: 5,
          jobDescription: prepJob.jobDescription || "",
        });

        // 2. Open practice mode panel in FloatingWidget
        useUIStore.getState().setPracticeOpen(true);
        useUIStore.getState().setExpanded(true);
      }
    } catch (e) {
      console.error("Error starting prep for job:", e);
    }
  }, []);

  // ─── Refs ───
  const transcriptionQueueRef = useRef<
    { source: SpeakerSource; chunk: Float32Array }[]
  >([]);
  const isTranscribingRef = useRef(false);
  const userStabilizerRef = useRef(new TimestampDeduplicator());
  const interviewerStabilizerRef = useRef(new TimestampDeduplicator());
  const echoSuppressorRef = useRef(new EchoSuppressor());
  const conversationRef = useRef<ChatBlock[]>([]);
  const autoDetectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoCaptureTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const lastDetectionTimeRef = useRef<number>(0);
  const autoAnswerConfidenceThresholdRef = useRef<number>(0.8);
  const deepgramFinalTextRef = useRef<{ user: string; interviewer: string }>({ user: "", interviewer: "" });
  // Persistent interviewer accumulator — immune to speaker changes and user interruptions
  const interviewerAccumulatorRef = useRef<string>("");
  const accumulatorCheckpointRef = useRef<number>(0);

  // Sync conversationRef with store
  useEffect(() => {
    conversationRef.current = conversation;
  }, [conversation]);

  // ─── Hooks ───
  const { isModelLoading, isModelLoaded, modelError, loadModel, transcribe } =
    useWhisper();
  const { generateAnswerWithTemplate, generateResponse } = useLLM();
  const { profile } = useProfile();

  // Pre-load Whisper model on startup
  useEffect(() => {
    loadModel();
  }, [loadModel]);

  // ─── Session timer ───
  useEffect(() => {
    if (isRecording) {
      sessionTimerRef.current = setInterval(() => {
        setSessionTime((prev: number) => prev + 1);
      }, 1000);
    } else {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
    }
    return () => {
      if (sessionTimerRef.current) clearInterval(sessionTimerRef.current);
    };
  }, [isRecording, setSessionTime]);

  // ─── Auto-capture in Code Mode ───
  useEffect(() => {
    if (isRecording && isCodeMode) {
      window.electronAPI.getSettings().then((res: any) => {
        if (res.success && res.settings?.autoCaptureCodingMode) {
          autoCaptureTimerRef.current = setInterval(() => {
            handleCaptureScreen();
          }, 30000);
        }
      });
    } else {
      if (autoCaptureTimerRef.current) {
        clearInterval(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
    }
    return () => {
      if (autoCaptureTimerRef.current) {
        clearInterval(autoCaptureTimerRef.current);
        autoCaptureTimerRef.current = null;
      }
    };
  }, [isRecording, isCodeMode]);

  // ─── Transcription queue processing ───
  const processTranscriptionQueue = useCallback(async () => {
    if (isTranscribingRef.current) return;
    if (!isModelLoaded) return;

    isTranscribingRef.current = true;
    try {
      while (transcriptionQueueRef.current.length > 0) {
        const nextItem = transcriptionQueueRef.current.shift();
        if (!nextItem) continue;

        try {
          const lastSpeakerBlocks = conversationRef.current
            .filter((b) => b.speaker === nextItem.source)
            .slice(-3);
          const promptText = lastSpeakerBlocks
            .map((b) => b.text)
            .join(" ")
            .split(/\s+/)
            .slice(-32)
            .join(" ");

          const result = await transcribe(nextItem.chunk, promptText);

          if (result && result.text.trim()) {
            const filterRes = filterHallucinations(result.text);
            if (!filterRes.valid) {
              console.log(
                `[HallucinationFilter] Discarded: "${result.text}" (Reason: ${filterRes.reason})`,
              );
              continue;
            }

            const text = filterRes.filteredText || result.text;

            // ─── Cross-channel echo suppression ───
            // System audio captures ALL audio output, including the user's
            // voice echoed back from the meeting app. Detect and suppress these.
            if (nextItem.source === "user") {
              echoSuppressorRef.current.recordUserTranscription(text);
            } else if (nextItem.source === "interviewer") {
              if (echoSuppressorRef.current.isEcho(text)) {
                continue; // Skip — this is the user's voice on the system audio channel
              }
              echoSuppressorRef.current.recordInterviewerTranscription(text);
              // Append to persistent interviewer accumulator (interruption-immune)
              interviewerAccumulatorRef.current += (interviewerAccumulatorRef.current ? " " : "") + text;
            }

            const stabilizer =
              nextItem.source === "user"
                ? userStabilizerRef.current
                : interviewerStabilizerRef.current;

            setConversation((prev: ChatBlock[]) => {
              const newConv = [...prev];
              const lastBlock =
                newConv.length > 0 ? newConv[newConv.length - 1] : null;

              let textToSet = "";
              if (!lastBlock || lastBlock.speaker !== nextItem.source) {
                stabilizer.clear();
                if (result.words && result.words.length > 0) {
                  textToSet = stabilizer.addUtteranceWithTimestamps(
                    result.words,
                  );
                } else {
                  textToSet = stabilizer.addChunkFallback(text);
                }
                newConv.push({
                  id: Date.now().toString() + Math.random().toString(),
                  speaker: nextItem.source,
                  text: textToSet,
                  timestamp: new Date(),
                });
              } else {
                if (result.words && result.words.length > 0) {
                  textToSet = stabilizer.addUtteranceWithTimestamps(
                    result.words,
                  );
                } else {
                  textToSet = stabilizer.addChunkFallback(text);
                }
                newConv[newConv.length - 1] = { ...lastBlock, text: textToSet };
              }

              conversationRef.current = newConv;

              // If new interviewer text arrives during detection window, reset it
              if (
                nextItem.source === "interviewer" &&
                autoDetectTimeoutRef.current
              ) {
                console.log(
                  "[Detection] New interviewer text arrived — resetting detection window",
                );
                clearTimeout(autoDetectTimeoutRef.current);
                autoDetectTimeoutRef.current = null;
                startDetectionWindow();
              }

              return newConv;
            });
          }
        } catch (error) {
          console.error("Failed to transcribe chunk:", error);
        }
      }
    } finally {
      isTranscribingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModelLoaded, transcribe, setConversation]);

  // ─── Deepgram Streaming Event Listeners ───
  useEffect(() => {
    if (!window.electronAPI?.deepgram) return;

    const unsubscribers: (() => void)[] = [];

    // On Transcript
    unsubscribers.push(
      window.electronAPI.deepgram.onTranscript((data: any) => {
        const text = data.text;
        const source = data.speaker as "user" | "interviewer";

        // Cross-channel echo suppression.
        // We only record the user's voice. We DO NOT record the interviewer's voice 
        // into the echo suppressor because Deepgram's interim updates would match 
        // themselves (same-channel) and suppress the rest of the sentence.
        if (source === "user") {
          echoSuppressorRef.current.recordUserTranscription(text);
        } else if (source === "interviewer") {
          if (echoSuppressorRef.current.isEcho(text)) {
            return; // Skip echo (it matched the user's mic)
          }
        }

        // Append to persistent interviewer accumulator on final results (interruption-immune)
        if (source === "interviewer" && data.isFinal) {
          interviewerAccumulatorRef.current += (interviewerAccumulatorRef.current ? " " : "") + text;
        }

        setConversation((prev: ChatBlock[]) => {
          const newConv = [...prev];
          const lastBlock =
            newConv.length > 0 ? newConv[newConv.length - 1] : null;

          if (!lastBlock || lastBlock.speaker !== source) {
            // Speaker changed or first block: reset final text for this source
            deepgramFinalTextRef.current[source] = "";
            const fullText = text;

            newConv.push({
              id: Date.now().toString() + Math.random().toString(),
              speaker: source,
              text: fullText,
              timestamp: new Date(),
            });

            if (data.isFinal) {
              deepgramFinalTextRef.current[source] = fullText;
            }
          } else {
            // Same speaker: append current interim/final to previously finalized text
            const previouslyFinalized = deepgramFinalTextRef.current[source];
            const fullText = previouslyFinalized + (previouslyFinalized && text ? " " : "") + text;

            newConv[newConv.length - 1] = { ...lastBlock, text: fullText };

            if (data.isFinal) {
              deepgramFinalTextRef.current[source] = fullText;
            }
          }

          conversationRef.current = newConv;

          if (source === "interviewer" && autoDetectTimeoutRef.current) {
            console.log("[Detection] New interviewer text arrived — resetting detection window");
            clearTimeout(autoDetectTimeoutRef.current);
            autoDetectTimeoutRef.current = null;
            startDetectionWindow();
          }

          return newConv;
        });
      })
    );

    // On Utterance End
    unsubscribers.push(
      window.electronAPI.deepgram.onUtteranceEnd((data: { speaker: string }) => {
        if (data.speaker === 'interviewer') {
          handleInterviewerSpeechEnd();
        }
      })
    );

    // On Speech Started
    unsubscribers.push(
      window.electronAPI.deepgram.onSpeechStarted((data: { speaker: string }) => {
        if (data.speaker === 'interviewer') {
          handleInterviewerSpeechStart();
        }
      })
    );

    return () => unsubscribers.forEach(unsub => unsub());
  }, []);

  // Expose transcription handler for E2E testing
  if (typeof window !== "undefined") {
    (window as any).__TEST_PROCESS_TRANSCRIPTION__ = (
      source: SpeakerSource,
      text: string,
    ) => {
      const filterRes = filterHallucinations(text);
      if (!filterRes.valid) return false;

      const filteredText = filterRes.filteredText || text;
      setConversation((prev: ChatBlock[]) => {
        const newConv = [...prev];
        newConv.push({
          id: Date.now().toString() + Math.random().toString(),
          speaker: source,
          text: filteredText,
          timestamp: new Date(),
        });
        return newConv;
      });
      return true;
    };
  }

  // Telemetry refs for latency tracking
  const speechStartPerfRef = useRef<number | null>(null);
  const speechEndPerfRef = useRef<number | null>(null);
  const speechStartTimeStrRef = useRef<string | null>(null);
  const speechEndTimeStrRef = useRef<string | null>(null);

  // Active speculative LLM generation abort controller
  const activeAutoAnswerAbortControllerRef = useRef<AbortController | null>(null);

  // ─── Detection Window ───
  const DETECTION_WINDOW_MS = 250;

  const startDetectionWindow = useCallback(() => {
    // 3s cooldown between detections to avoid flooding the candidates list
    if (Date.now() - lastDetectionTimeRef.current < 3000) return;

    autoDetectTimeoutRef.current = setTimeout(async () => {
      autoDetectTimeoutRef.current = null;

      if (!autoDetectionEnabled) return;

      // Use persistent accumulator instead of conversation blocks
      // to avoid fragmentation from user interruptions
      const fullAccumulator = interviewerAccumulatorRef.current;
      const checkpoint = accumulatorCheckpointRef.current;
      const newText = fullAccumulator.slice(checkpoint).trim();
      if (!newText) return;

      const speechStartPerf = speechStartPerfRef.current;
      const speechEndPerf = speechEndPerfRef.current;
      const speechStartTimeStr = speechStartTimeStrRef.current;
      const speechEndTimeStr = speechEndTimeStrRef.current;

      const evalStartTime = performance.now();
      const detection = await isQuestion(newText);
      const totalEvalMs = performance.now() - evalStartTime;

      const speechDurationMs = (speechStartPerf && speechEndPerf)
        ? (speechEndPerf - speechStartPerf)
        : null;
      const vadSilenceDelayMs = speechEndPerf
        ? (evalStartTime - speechEndPerf)
        : null;

      const heuristicStr = `${detection.latencyMs?.heuristic.toFixed(2)}ms`;
      const nlpGateStr = detection.latencyMs?.nlpGate !== undefined
        ? `${detection.latencyMs.nlpGate.toFixed(2)}ms`
        : 'N/A (offline/skipped)';

      const isPassed = detection.isQuestion && detection.syntacticallyComplete;
      console.groupCollapsed(
        `[Question Detection] ${isPassed ? '✅ QUESTION DETECTED' : '❌ NOT DETECTED'} (${totalEvalMs.toFixed(1)}ms)`
      );
      console.log(`Utterance: "${newText}"`);
      console.log(
        `Score: ${detection.score} (Threshold: 25) | Confidence: ${(detection.confidence * 100).toFixed(0)}% | Complete: ${detection.syntacticallyComplete ? 'Yes ✅' : 'No ❌'}`
      );
      console.log(`Signals: [${detection.signals.join(', ') || 'none'}]`);
      console.log(`Speech Timestamps: Started=${speechStartTimeStr || 'N/A'} | Ended=${speechEndTimeStr || 'N/A'} | Duration=${speechDurationMs ? `${speechDurationMs.toFixed(0)}ms` : 'N/A'}`);
      console.log(`VAD Silence Delay: ${vadSilenceDelayMs ? `${vadSilenceDelayMs.toFixed(0)}ms` : 'N/A'} (Speech Stop ➔ Detection Trigger)`);
      console.log(`Latency Breakdown: Heuristic=${heuristicStr} | spaCy NLP=${nlpGateStr} | Total=${totalEvalMs.toFixed(2)}ms`);

      // Only proceed if it is syntactically complete (Tier 1 Gate passed)
      if (isPassed) {
        lastDetectionTimeRef.current = Date.now();
        accumulatorCheckpointRef.current = fullAccumulator.length;
        // Add to candidates list — deduplication happens inside the store
        const candidateId = addCandidateQuestion(
          newText,
          detection.confidence,
          detection.signals,
        );

        if (candidateId) {
          console.log(`Action: Candidate Question Added (ID: ${candidateId})`);
          // Auto-generate answer for high-confidence questions
          if (detection.confidence >= autoAnswerConfidenceThresholdRef.current) {
            console.log(`Action: Triggering speculative LLM answer (Confidence ${detection.confidence.toFixed(2)} >= ${autoAnswerConfidenceThresholdRef.current})`);
            const controller = new AbortController();
            activeAutoAnswerAbortControllerRef.current = controller;

            const telemetryMeta = {
              speechStartPerf,
              speechEndPerf,
              speechStartTimeStr,
              speechEndTimeStr,
              speechDurationMs,
              vadSilenceDelayMs,
              detectionEvalMs: totalEvalMs,
              detectionResult: detection,
            };

            handlePickQuestionRef.current(candidateId, newText, controller.signal, telemetryMeta).finally(() => {
              if (activeAutoAnswerAbortControllerRef.current === controller) {
                activeAutoAnswerAbortControllerRef.current = null;
              }
            });
          }
        } else {
          console.log(`Action: Candidate question ignored (Duplicate detected in store)`);
        }
      }
      console.groupEnd();
    }, DETECTION_WINDOW_MS);
  }, [autoDetectionEnabled, addCandidateQuestion]);

  // Called when interviewer's VAD detects speech-end
  const handleInterviewerSpeechEnd = useCallback(() => {
    speechEndPerfRef.current = performance.now();
    speechEndTimeStrRef.current = new Date().toLocaleTimeString();
    console.log(
      "[Detection] Interviewer speech ended — starting detection window",
    );
    if (autoDetectTimeoutRef.current) {
      clearTimeout(autoDetectTimeoutRef.current);
      autoDetectTimeoutRef.current = null;
    }
    startDetectionWindow();
  }, [startDetectionWindow]);

  // Called when interviewer's VAD detects speech-start (resumed speaking)
  const handleInterviewerSpeechStart = useCallback(() => {
    speechStartPerfRef.current = performance.now();
    speechStartTimeStrRef.current = new Date().toLocaleTimeString();
    if (autoDetectTimeoutRef.current) {
      console.log(
        "[Detection] Interviewer resumed speaking — cancelling detection window",
      );
      clearTimeout(autoDetectTimeoutRef.current);
      autoDetectTimeoutRef.current = null;
    }

    // Tier 2: Speculative cancellation
    if (activeAutoAnswerAbortControllerRef.current) {
      console.log("[Detection] Interviewer resumed speaking — ABORTING speculative LLM generation!");
      activeAutoAnswerAbortControllerRef.current.abort();
      activeAutoAnswerAbortControllerRef.current = null;
    }
  }, []);

  const handleAudioChunk = useCallback(
    async (source: SpeakerSource, pcmSamples: Float32Array) => {
      if (!isModelLoaded) return;
      transcriptionQueueRef.current.push({ source, chunk: pcmSamples });
      void processTranscriptionQueue();
    },
    [isModelLoaded, processTranscriptionQueue],
  );

  const { startRecording, stopRecording, clearChunks, audioLevels } =
    useMixedAudioRecorder(
      handleAudioChunk,
      handleInterviewerSpeechEnd,
      handleInterviewerSpeechStart,
    );

  // ─── User picks a candidate question → generate single inline answer ───
  const handlePickQuestion = async (
    candidateId: string,
    _questionText: string,
    signal?: AbortSignal,
    telemetryMeta?: {
      speechStartPerf: number | null;
      speechEndPerf: number | null;
      speechStartTimeStr: string | null;
      speechEndTimeStr: string | null;
      speechDurationMs: number | null;
      vadSilenceDelayMs: number | null;
      detectionEvalMs: number;
      detectionResult: any;
    }
  ) => {
    // Mark the candidate as "answering"
    setCandidateStatus(candidateId, "answering");
    updateCandidateAnswer(candidateId, { answer: "", isStreaming: true });

    const recentBlocks = conversationRef.current.slice(-5);
    const contextTranscript = recentBlocks
      .map((b) => `${b.speaker === "user" ? "ME" : "Interviewer"}: ${b.text}`)
      .join("\n\n");

    const settingsRes = await window.electronAPI.getSettings();
    let defaultInterviewType =
      settingsRes.success && settingsRes.settings
        ? settingsRes.settings.interviewType
        : "general";

    // 1. Classify the question details (25 categories)
    const detailedCategory = classifyDetailedQuestion(contextTranscript);
    const mappedInterviewType = classifyQuestion(contextTranscript);
    const interviewType = mappedInterviewType !== "general" ? mappedInterviewType : defaultInterviewType;

    // 2. Retrieve matching story
    const { recentStoryIds, addRecentStoryId } = useAnswerStore.getState();
    const retrievalResult = retrieveStory(
      contextTranscript,
      detailedCategory,
      profile.stories || [],
      recentStoryIds,
      profile.resume
    );

    // If story was chosen, record usage to avoid instant repeats
    if (retrievalResult.chosenSource === 'story' && retrievalResult.selectedStory) {
      addRecentStoryId(retrievalResult.selectedStory.id);
    }

    // 3. Prepare the prompt context and pre-compute debug prompt
    const promptContext: PromptContext = {
      interviewType: interviewType as any,
      currentQuestion: contextTranscript,
      conversationHistory: "",
      resume: profile.resume,
      jobDescription: profile.jobDescription,
      company: profile.targetCompany,
      useBulletPoints,
      selectedStory: retrievalResult.selectedStory,
      retrievalSource: retrievalResult.chosenSource,
      similarityScore: retrievalResult.similarityScore
    };
    const resolvedTemplate = getPromptTemplate(promptContext);
    const llmReqStartTime = performance.now();
    let firstTokenTime: number | null = null;

    try {
      let streamedAnswer = "";

      const finalResponse = await generateAnswerWithTemplate(
        promptContext,
        (chunk) => {
          if (!firstTokenTime) {
            firstTokenTime = performance.now();
            const ttftMs = firstTokenTime - llmReqStartTime;
            const e2eMs = (telemetryMeta?.speechEndPerf)
              ? (firstTokenTime - telemetryMeta.speechEndPerf)
              : (firstTokenTime - llmReqStartTime);

            console.groupCollapsed(
              `[Pipeline Telemetry] ⚡ AI Stream Started (TTFT: ${ttftMs.toFixed(0)}ms | Total E2E: ${e2eMs.toFixed(0)}ms)`
            );
            console.log(`Utterance: "${_questionText}"`);
            if (telemetryMeta) {
              console.log(`🎙️ Speech Metrics:`);
              console.log(`   Started: ${telemetryMeta.speechStartTimeStr || 'N/A'} | Ended: ${telemetryMeta.speechEndTimeStr || 'N/A'}`);
              console.log(`   Speech Duration: ${telemetryMeta.speechDurationMs !== null ? `${telemetryMeta.speechDurationMs.toFixed(0)}ms` : 'N/A'}`);
              console.log(`   VAD Silence Delay: ${telemetryMeta.vadSilenceDelayMs !== null ? `${telemetryMeta.vadSilenceDelayMs.toFixed(0)}ms` : 'N/A'} (Speech Stop ➔ Detection Trigger)`);
              console.log(`🔍 Detection Timings:`);
              console.log(`   Detection Score: ${telemetryMeta.detectionResult?.score} | Signals: [${telemetryMeta.detectionResult?.signals?.join(', ') || 'none'}]`);
              console.log(`   Detector Latency: Heuristic=${telemetryMeta.detectionResult?.latencyMs?.heuristic?.toFixed(2)}ms | spaCy NLP=${telemetryMeta.detectionResult?.latencyMs?.nlpGate?.toFixed(2) || 'N/A'}ms | Total=${telemetryMeta.detectionEvalMs.toFixed(2)}ms`);
            }
            console.log(`🤖 AI Streaming Metrics:`);
            console.log(`   LLM Time-To-First-Token (TTFT): ${ttftMs.toFixed(1)}ms`);
            console.log(`   ⚡ Total E2E (Speech Stop ➔ AI Stream Started): ${e2eMs.toFixed(1)}ms`);
            console.groupEnd();
          }

          streamedAnswer += chunk;
          updateCandidateAnswer(candidateId, {
            answer: streamedAnswer,
            isStreaming: true,
          });
        },
        undefined,
        signal
      );

      const totalLatencyMs = performance.now() - llmReqStartTime;
      const ttftMs = firstTokenTime ? (firstTokenTime - llmReqStartTime) : 0;

      const activeModel = settingsRes.success && settingsRes.settings
        ? (settingsRes.settings.mistralModel || settingsRes.settings.geminiModel || "mistral-3b")
        : "mistral-3b";

      // Print all pipeline debug telemetry directly to developer console group
      console.groupCollapsed(`[Pipeline Debug Info] 🎯 Source: ${retrievalResult.chosenSource} | Latency: ${(totalLatencyMs / 1000).toFixed(2)}s`);
      console.log(`Question: "${_questionText}"`);
      console.log(`Classification Category: ${detailedCategory}`);
      console.log(`Chosen Source: ${retrievalResult.chosenSource === 'story' ? `Story: "${retrievalResult.selectedStory?.title}"` : retrievalResult.chosenSource}`);
      console.log(`Similarity Score: ${retrievalResult.similarityScore !== undefined ? retrievalResult.similarityScore.toFixed(3) : 'N/A'}`);
      console.log(`Model Used: ${activeModel}`);
      console.log(`Prompt Version: 2.1-grounded-narrative`);
      console.log(`Time to First Token (TTFT): ${ttftMs.toFixed(0)}ms`);
      console.log(`Total Generation Latency: ${totalLatencyMs.toFixed(0)}ms`);
      if (retrievalResult.debugInfo?.retrievedStories) {
        console.log(`Story Bank Match Matrices:`);
        console.table(retrievalResult.debugInfo.retrievedStories);
      }
      console.log(`Generated Prompt Context:`);
      console.log(resolvedTemplate.system);
      console.groupEnd();

      // 4. Predict follow-up questions from the story context
      const followUps = await predictFollowUps(
        contextTranscript,
        finalResponse,
        interviewType as any,
        retrievalResult.selectedStory
      );

      updateCandidateAnswer(candidateId, {
        isStreaming: false,
        status: "answered",
        followUps,
        debugInfo: undefined // Completely clear debugInfo from UI state
      });
    } catch (error: any) {
      if (error?.message === 'AbortError') {
        console.log(`[Detection] Answer generation for ${candidateId} was successfully aborted.`);
        // Clear the UI so it doesn't look broken
        updateCandidateAnswer(candidateId, {
          answer: "Cancelled (Interviewer continued speaking...)",
          isStreaming: false,
          status: "answered"
        });
        return;
      }
      console.error("Failed to generate answer:", error);
      updateCandidateAnswer(candidateId, {
        answer: "Failed to generate answer.",
        isStreaming: false,
        status: "answered",
      });
    }
  };

  // We need to pass handlePickQuestion down to the dependency array in startDetectionWindow,
  // but to avoid circular dependencies we can use a ref for the latest handlePickQuestion.
  const handlePickQuestionRef = useRef(handlePickQuestion);
  useEffect(() => {
    handlePickQuestionRef.current = handlePickQuestion;
  }, [handlePickQuestion]);

  // ─── Manual generate (Ctrl+Shift+G) → add as candidate and immediately generate answer ───
  const handleGenerateAnswer = async () => {
    const lastInterviewerBlock = [...conversationRef.current]
      .reverse()
      .find((b) => b.speaker === "interviewer");
    const questionText = lastInterviewerBlock?.text || "";
    if (!questionText.trim()) return;

    // Add as a candidate first so it appears in the UI
    addCandidateQuestion(questionText, 1.0, ["manual"]);

    // Get the newly added candidate's ID (it was prepended as first item)
    const candidates = useAnswerStore.getState().candidateQuestions;
    const newCandidate = candidates[0];
    if (newCandidate) {
      await handlePickQuestion(newCandidate.id, questionText);
    }
  };

  // ─── Action handlers ───

  const handleToggleRecording = async () => {
    if (isRecording) {
      stopRecording();
      setIsRecording(false);
      if (autoDetectTimeoutRef.current) {
        clearTimeout(autoDetectTimeoutRef.current);
        autoDetectTimeoutRef.current = null;
      }

      // Auto-save session
      if (conversationRef.current.length > 0) {
        try {
          const metrics = analyzeDelivery(conversationRef.current, sessionTime);
          const now = new Date().toISOString();
          const sessionData = {
            id: Date.now().toString(),
            startTime: now,
            endTime: now,
            timestamp: now,
            duration: sessionTime,
            interviewType: "general",
            type: "general",
            questionCount: detectedQuestions.length + candidateQuestions.length,
            conversation: conversationRef.current,
            transcript: conversationRef.current,
            answers: answers,
            detectedQuestions: detectedQuestions,
            metrics: metrics,
            deliveryMetrics: metrics,
          };
          const res = await window.electronAPI.session.save(sessionData);
          if (!res.success) {
            console.error("Failed to save session:", res.error);
          }
        } catch (error) {
          console.error("Error saving session:", error);
        }
      }
    } else {
      try {
        if (!isModelLoaded && !isModelLoading) {
          await loadModel();
        }
        transcriptionQueueRef.current = [];
        isTranscribingRef.current = false;
        userStabilizerRef.current.clear();
        interviewerStabilizerRef.current.clear();
        deepgramFinalTextRef.current = { user: "", interviewer: "" };
        interviewerAccumulatorRef.current = "";
        accumulatorCheckpointRef.current = 0;
        clearTranscript();
        conversationRef.current = [];
        clearChunks();
        clearCandidateQuestions();
        clearDetectedQuestions();
        await startRecording();
        setIsRecording(true);
      } catch (error) {
        console.error("Failed to start:", error);
      }
    }
  };

  const handleCaptureScreen = async () => {
    setCapturing(true);
    try {
      if (isCodeMode) {
        const captureResult = await window.electronAPI.captureScreen();
        if (!captureResult.success || !captureResult.imageData) {
          console.error("Screen capture failed:", captureResult.error);
          return;
        }

        const codePrompt = getCodeAnalysisPrompt({
          resume: profile.resume,
          jobDescription: profile.jobDescription,
        });

        const newAnswer: Answer = {
          id: Date.now().toString(),
          source: "screen-capture",
          question: "💻 Code Analysis",
          answer: "",
          timestamp: new Date(),
          isStreaming: true,
          detectedType: "coding",
        };

        addAnswer(newAnswer);
        setExpanded(true);

        let streamedAnswer = "";
        await generateResponse(
          codePrompt.user,
          undefined,
          (chunk) => {
            streamedAnswer += chunk;
            updateAnswer(newAnswer.id, {
              answer: streamedAnswer,
              isStreaming: true,
            });
          },
          captureResult.imageData,
        );
        updateAnswer(newAnswer.id, { isStreaming: false });
      } else {
        const result = await window.electronAPI.captureAndAnalyze();
        if (result.success && result.answer) {
          addAnswer({
            id: Date.now().toString(),
            source: "screen-capture",
            question: "Screen Analysis",
            answer: result.answer,
            timestamp: new Date(),
            isStreaming: false,
          });
          setExpanded(true);
        } else {
          console.error("Screen capture failed:", result.error);
        }
      }
    } catch (error) {
      console.error("Failed to capture screen:", error);
    } finally {
      setCapturing(false);
    }
  };

  const handleClearTranscript = () => {
    userStabilizerRef.current.clear();
    interviewerStabilizerRef.current.clear();
    deepgramFinalTextRef.current = { user: "", interviewer: "" };
    interviewerAccumulatorRef.current = "";
    accumulatorCheckpointRef.current = 0;
    clearTranscript();
    conversationRef.current = [];
    if (autoDetectTimeoutRef.current) {
      clearTimeout(autoDetectTimeoutRef.current);
      autoDetectTimeoutRef.current = null;
    }
  };

  const handleClose = () => {
    window.electronAPI?.quitApp();
  };

  const handleToggleAutoDetection = () => {
    setAutoDetectionEnabled((prev) => !prev);
  };

  const handleClearAll = () => {
    clearCandidateQuestions();
    clearDetectedQuestions();
  };

  // ─── Global keyboard shortcuts ───
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    if (window.electronAPI?.onShortcut) {
      unsubscribers.push(
        window.electronAPI.onShortcut("shortcut:capture-screen", () => {
          handleCaptureScreen();
        }),
      );
      unsubscribers.push(
        window.electronAPI.onShortcut("shortcut:generate-answer", () => {
          handleGenerateAnswer();
        }),
      );
      unsubscribers.push(
        window.electronAPI.onShortcut("shortcut:toggle-widget", () => {
          toggleExpanded();
        }),
      );
      unsubscribers.push(
        window.electronAPI.onShortcut("shortcut:toggle-recording", () => {
          handleToggleRecording();
        }),
      );
      unsubscribers.push(
        window.electronAPI.onShortcut("shortcut:region-capture", () => {
          handleRegionCapture();
        }),
      );
      unsubscribers.push(
        window.electronAPI.onShortcut("shortcut:toggle-teleprompter", () => {
          toggleTeleprompterMode();
        }),
      );
      unsubscribers.push(
        window.electronAPI.onShortcut("shortcut:opacity-up", () => {
          const state = useUIStore.getState();
          state.setWidgetOpacity(Math.min(100, state.widgetOpacity + 5));
        }),
      );
      unsubscribers.push(
        window.electronAPI.onShortcut("shortcut:opacity-down", () => {
          const state = useUIStore.getState();
          state.setWidgetOpacity(Math.max(5, state.widgetOpacity - 5));
        }),
      );
    }

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [conversation, answers.length, toggleTeleprompterMode]);

  // ─── Region Capture ───
  const [regionSelectState, setRegionSelectState] = useState<{
    screenshotData: string;
  } | null>(null);

  const handleRegionCapture = async () => {
    try {
      const captureResult = await window.electronAPI.captureScreen();
      if (captureResult.success && captureResult.imageData) {
        setRegionSelectState({ screenshotData: captureResult.imageData });
      }
    } catch (error) {
      console.error("Region capture failed:", error);
    }
  };

  const handleRegionResult = async (croppedImageData: string) => {
    setRegionSelectState(null);
    setCapturing(true);
    try {
      const prompt = isCodeMode
        ? getCodeAnalysisPrompt({
          resume: profile.resume,
          jobDescription: profile.jobDescription,
        })
        : undefined;

      const newAnswer: Answer = {
        id: Date.now().toString(),
        source: "screen-capture",
        question: isCodeMode
          ? "💻 Code Analysis (Region)"
          : "🔍 Region Analysis",
        answer: "",
        timestamp: new Date(),
        isStreaming: true,
        detectedType: isCodeMode ? "coding" : undefined,
      };
      addAnswer(newAnswer);
      setExpanded(true);

      let streamedAnswer = "";
      const userPrompt =
        prompt?.user ||
        "Analyze this screenshot region. Extract questions, code, or information and provide a helpful response.";

      await generateResponse(
        userPrompt,
        undefined,
        (chunk) => {
          streamedAnswer += chunk;
          updateAnswer(newAnswer.id, {
            answer: streamedAnswer,
            isStreaming: true,
          });
        },
        croppedImageData,
      );
      updateAnswer(newAnswer.id, { isStreaming: false });
    } catch (error) {
      console.error("Region analysis failed:", error);
    } finally {
      setCapturing(false);
    }
  };

  // ─── Render ───
  return (
    <>
      <FloatingWidget
        isExpanded={isExpanded}
        isChatOpen={isChatOpen}
        isHistoryOpen={isHistoryOpen}
        isPracticeOpen={isPracticeOpen}
        isRecording={isRecording}
        isCapturing={isCapturing}
        isGenerating={isGenerating}
        isTeleprompterMode={isTeleprompterMode}
        sessionTime={sessionTime}
        conversation={conversation}
        isModelLoading={isModelLoading}
        modelError={modelError}
        candidateQuestions={candidateQuestions}
        detectedQuestions={detectedQuestions}
        expandedQuestionId={expandedQuestionId}
        autoDetectionEnabled={autoDetectionEnabled}
        sttEngine={sttEngine}
        sttModel={sttModel}
        audioLevels={audioLevels}
        onToggleExpanded={toggleExpanded}
        onToggleRecording={handleToggleRecording}
        onCaptureScreen={handleCaptureScreen}
        onGenerateAnswer={handleGenerateAnswer}
        onClearTranscript={handleClearTranscript}
        onToggleChat={toggleChat}
        onToggleHistory={toggleHistory}
        onTogglePractice={togglePractice}
        onClose={handleClose}
        onPickQuestion={handlePickQuestion}
        onDismissCandidate={removeCandidateQuestion}
        onSelectOption={() => { }}
        onClearDetectedQuestions={handleClearAll}
        onToggleAutoDetection={handleToggleAutoDetection}
      />
      {regionSelectState && (
        <RegionSelector
          screenshotData={regionSelectState.screenshotData}
          onCapture={handleRegionResult}
          onCancel={() => setRegionSelectState(null)}
        />
      )}
    </>
  );
}

export default App;
