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
import { classifyQuestion } from "./lib/interview-classifier";
import { isQuestionSync } from "./lib/question-detector";
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
      }
    });
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

              // If user starts speaking, cancel any pending detection
              if (nextItem.source === "user" && autoDetectTimeoutRef.current) {
                clearTimeout(autoDetectTimeoutRef.current);
                autoDetectTimeoutRef.current = null;
              }

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

            if (source === "user" && autoDetectTimeoutRef.current) {
                clearTimeout(autoDetectTimeoutRef.current);
                autoDetectTimeoutRef.current = null;
            }

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

  // ─── Detection Window ───
  const DETECTION_WINDOW_MS = 1500;

  const startDetectionWindow = useCallback(() => {
    // 3s cooldown between detections to avoid flooding the candidates list
    if (Date.now() - lastDetectionTimeRef.current < 3000) return;

    autoDetectTimeoutRef.current = setTimeout(() => {
      autoDetectTimeoutRef.current = null;

      if (!autoDetectionEnabled) return;

      const conv = conversationRef.current;
      const lastInterviewerBlock = [...conv]
        .reverse()
        .find((b) => b.speaker === "interviewer");
      if (!lastInterviewerBlock || !lastInterviewerBlock.text.trim()) return;

      const detection = isQuestionSync(lastInterviewerBlock.text);

      console.log(
        `[Detection] "${lastInterviewerBlock.text.slice(0, 80)}..." => ` +
          `isQuestion=${detection.isQuestion}, confidence=${detection.confidence.toFixed(2)}, ` +
          `signals=[${detection.signals.join(", ")}]`,
      );

      if (detection.isQuestion) {
        lastDetectionTimeRef.current = Date.now();
        // Add to candidates list — deduplication happens inside the store
        const candidateId = addCandidateQuestion(
          lastInterviewerBlock.text,
          detection.confidence,
          detection.signals,
        );

        // Auto-generate answer for high-confidence questions
        if (candidateId && detection.confidence >= autoAnswerConfidenceThresholdRef.current) {
            console.log(`[Detection] Auto-generating answer for candidate ${candidateId} (confidence ${detection.confidence.toFixed(2)} >= ${autoAnswerConfidenceThresholdRef.current})`);
            handlePickQuestionRef.current(candidateId, lastInterviewerBlock.text);
        }
      }
    }, DETECTION_WINDOW_MS);
  }, [autoDetectionEnabled, addCandidateQuestion]);

  // Called when interviewer's VAD detects speech-end
  const handleInterviewerSpeechEnd = useCallback(() => {
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
    if (autoDetectTimeoutRef.current) {
      console.log(
        "[Detection] Interviewer resumed speaking — cancelling detection window",
      );
      clearTimeout(autoDetectTimeoutRef.current);
      autoDetectTimeoutRef.current = null;
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
  ) => {
    // Mark the candidate as "answering"
    setCandidateStatus(candidateId, "answering");
    updateCandidateAnswer(candidateId, { answer: "", isStreaming: true });

    const recentBlocks = conversationRef.current.slice(-5);
    const contextTranscript = recentBlocks
      .map((b) => `${b.speaker === "user" ? "ME" : "Interviewer"}: ${b.text}`)
      .join("\n\n");

    const settingsRes = await window.electronAPI.getSettings();
    let interviewType =
      settingsRes.success && settingsRes.settings
        ? settingsRes.settings.interviewType
        : "general";

    const detected = classifyQuestion(contextTranscript);
    if (detected !== "general") {
      interviewType = detected;
    }

    try {
      let streamedAnswer = "";

      await generateAnswerWithTemplate(
        {
          interviewType: interviewType as any,
          currentQuestion: contextTranscript,
          conversationHistory: "",
          resume: profile.resume,
          jobDescription: profile.jobDescription,
          company: profile.targetCompany,
          useBulletPoints,
        },
        (chunk) => {
          streamedAnswer += chunk;
          updateCandidateAnswer(candidateId, {
            answer: streamedAnswer,
            isStreaming: true,
          });
        },
      );

      updateCandidateAnswer(candidateId, {
        isStreaming: false,
        status: "answered",
      });
    } catch (error) {
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
        onRegionCapture={handleRegionCapture}
        onGenerateAnswer={handleGenerateAnswer}
        onClearTranscript={handleClearTranscript}
        onToggleChat={toggleChat}
        onToggleHistory={toggleHistory}
        onTogglePractice={togglePractice}
        onClose={handleClose}
        onPickQuestion={handlePickQuestion}
        onDismissCandidate={removeCandidateQuestion}
        onSelectOption={() => {}}
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
