import { useState, useCallback, useRef, useEffect } from 'react';
import { HeaderOverlay } from './components/HeaderOverlay/HeaderOverlay';
import { TranscriptionBar } from './components/TranscriptionBar/TranscriptionBar';
import { AnswerWindow, QAPair } from './components/AnswerWindow/AnswerWindow';
import { AnalyzeScreenModal } from './components/AnalyzeScreen/AnalyzeScreenModal';
import { useWhisper } from './hooks/useWhisper';
import { useMixedAudioRecorder } from './hooks/useMixedAudioRecorder';
import { useLLM } from './hooks/useLLM';
import { OVERLAY_WIDTH, OVERLAY_HEIGHT } from './constants/overlay-dimensions';

// Window size type
interface WindowSize {
  width: number;
  height: number;
}

// Window size configurations for different states
const WINDOW_SIZES: Record<string, WindowSize> = {
  headerOnly: { width: OVERLAY_WIDTH, height: OVERLAY_HEIGHT },
  withTranscript: { width: 800, height: 150 },
  withAnswerWindow: { width: 800, height: 600 },
  withBoth: { width: 800, height: 700 },
  analyzeModal: { width: 800, height: 300 },
};

function App(): JSX.Element {
  // Transcription state
  const [transcript, setTranscript] = useState<string>('');
  const lastProcessedChunkRef = useRef(0);

  // Q&A state
  const [qaPairs, setQAPairs] = useState<QAPair[]>([]);
  const [currentQAIndex, setCurrentQAIndex] = useState(0);
  const [showAnswerWindow, setShowAnswerWindow] = useState(false);

  // Question detection state
  const lastTranscriptRef = useRef<string>('');
  const questionDetectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Session timer (in seconds)
  const [sessionTime, setSessionTime] = useState(0);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Analyze screen modal state
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);

  // Hooks
  const { isModelLoading, isModelLoaded, modelError, loadModel, transcribe } = useWhisper();
  const { generateInterviewAnswer } = useLLM();

  // Helper function to resize window based on current/future state
  // Call this BEFORE changing state to ensure window is ready
  const resizeWindowForState = useCallback((options: {
    hasTranscript?: boolean;
    hasAnswerWindow?: boolean;
    hasAnalyzeModal?: boolean;
  }) => {
    const { hasTranscript = false, hasAnswerWindow = false, hasAnalyzeModal = false } = options;

    let targetSize: WindowSize;

    if (hasAnalyzeModal) {
      targetSize = WINDOW_SIZES.analyzeModal;
    } else if (hasTranscript && hasAnswerWindow) {
      targetSize = WINDOW_SIZES.withBoth;
    } else if (hasAnswerWindow) {
      targetSize = WINDOW_SIZES.withAnswerWindow;
    } else if (hasTranscript) {
      targetSize = WINDOW_SIZES.withTranscript;
    } else {
      targetSize = WINDOW_SIZES.headerOnly;
    }

    return window.electronAPI?.resizeWindow(targetSize.width, targetSize.height);
  }, []);

  // Real-time audio processing callback
  const handleAudioData = useCallback(async (chunks: Blob[]) => {
    if (chunks.length <= lastProcessedChunkRef.current || !isModelLoaded) {
      return;
    }

    try {
      const audioBlob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const allAudioData = audioBuffer.getChannelData(0);

      const samplesPerChunk = 48000;
      const alreadyProcessedSamples = lastProcessedChunkRef.current * samplesPerChunk;
      const newAudioData = allAudioData.slice(alreadyProcessedSamples);

      if (newAudioData.length === 0) {
        lastProcessedChunkRef.current = chunks.length;
        return;
      }

      const result = await transcribe(newAudioData);
      lastProcessedChunkRef.current = chunks.length;

      if (result && result.trim()) {
        setTranscript(prev => prev ? `${prev} ${result}` : result);
      }
    } catch (error) {
      console.error('Failed to transcribe chunk:', error);
    } finally {
      // Transcription complete
    }
  }, [isModelLoaded, transcribe]);

  const { isRecording, startRecording, stopRecording, clearChunks } = useMixedAudioRecorder(handleAudioData);

  // Start session timer when recording starts
  useEffect(() => {
    if (isRecording) {
      sessionTimerRef.current = setInterval(() => {
        setSessionTime(prev => prev + 1);
      }, 1000);
    } else {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
    }

    return () => {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
      }
    };
  }, [isRecording]);

  // Question detection: Detect when user stops talking (2 second pause)
  useEffect(() => {
    if (transcript === lastTranscriptRef.current) return;

    // Clear existing timer
    if (questionDetectionTimerRef.current) {
      clearTimeout(questionDetectionTimerRef.current);
    }

    // Set new timer to detect question after 2 seconds of silence
    questionDetectionTimerRef.current = setTimeout(() => {
      if (transcript && transcript !== lastTranscriptRef.current) {
        // Detect if transcript ends with question mark or contains question words
        const isQuestion =
          transcript.endsWith('?') ||
          /\b(what|how|why|when|where|who|tell me|describe|explain|can you)\b/i.test(transcript);

        if (isQuestion) {
          handleGenerateAnswer(transcript);
        }
      }
      lastTranscriptRef.current = transcript;
    }, 2000);

    return () => {
      if (questionDetectionTimerRef.current) {
        clearTimeout(questionDetectionTimerRef.current);
      }
    };
  }, [transcript]);

  // Generate AI answer for detected question
  const handleGenerateAnswer = async (question: string) => {
    if (!question.trim()) return;

    // Resize window BEFORE showing the answer window
    await resizeWindowForState({
      hasTranscript: !!transcript,
      hasAnswerWindow: true,
    });

    // Create new Q&A pair with streaming placeholder
    const newQA: QAPair = {
      id: Date.now().toString(),
      question,
      answer: '',
      timestamp: new Date(),
      isStreaming: true,
    };

    setQAPairs(prev => [...prev, newQA]);
    setCurrentQAIndex(qaPairs.length);
    setShowAnswerWindow(true);

    try {
      // Stream the answer
      let streamedAnswer = '';
      await generateInterviewAnswer(
        question,
        undefined, // TODO: Add resume context
        (chunk) => {
          streamedAnswer += chunk;
          // Update the Q&A pair with streamed content
          setQAPairs(prev =>
            prev.map(qa =>
              qa.id === newQA.id
                ? { ...qa, answer: streamedAnswer, isStreaming: true }
                : qa
            )
          );
        }
      );

      // Mark streaming as complete
      setQAPairs(prev =>
        prev.map(qa =>
          qa.id === newQA.id
            ? { ...qa, isStreaming: false }
            : qa
        )
      );

      // Clear the question transcript after generating answer
      setTranscript('');
    } catch (error) {
      console.error('Failed to generate answer:', error);
      // Remove failed Q&A
      setQAPairs(prev => prev.filter(qa => qa.id !== newQA.id));
    }
  };

  // Handler functions
  const handleToggleRecording = async () => {
    if (isRecording) {
      stopRecording();
    } else {
      try {
        if (!isModelLoaded) {
          await loadModel();
        }
        setTranscript('');
        lastProcessedChunkRef.current = 0;
        clearChunks();
        await startRecording();
      } catch (error) {
        console.error('Failed to start:', error);
      }
    }
  };

  const handleClearTranscript = async () => {
    // Resize window based on what will remain visible
    await resizeWindowForState({
      hasTranscript: false,
      hasAnswerWindow: showAnswerWindow && qaPairs.length > 0,
    });
    setTranscript('');
    lastTranscriptRef.current = '';
  };

  const handleClearQA = async () => {
    // Resize window before hiding answer window
    await resizeWindowForState({
      hasTranscript: !!transcript,
      hasAnswerWindow: false,
    });
    setQAPairs([]);
    setCurrentQAIndex(0);
    setShowAnswerWindow(false);
  };

  const handleNavigateQA = (index: number) => {
    setCurrentQAIndex(Math.max(0, Math.min(index, qaPairs.length - 1)));
  };

  const handleAIHelp = () => {
    // Manual trigger for AI help
    if (transcript) {
      handleGenerateAnswer(transcript);
    }
  };

  const handleAnalyzeScreen = async () => {
    // Resize window BEFORE showing the modal
    await resizeWindowForState({ hasAnalyzeModal: true });
    setShowAnalyzeModal(true);
  };

  const handleCloseAnalyzeModal = async () => {
    // Resize window back based on current visible content
    await resizeWindowForState({
      hasTranscript: !!transcript,
      hasAnswerWindow: showAnswerWindow && qaPairs.length > 0,
    });
    setShowAnalyzeModal(false);
  };

  const handleAnalyzeComplete = async (answer: string) => {
    // Resize for answer window (modal will close, so we need answer window size)
    await resizeWindowForState({
      hasTranscript: !!transcript,
      hasAnswerWindow: true,
    });

    // Create a new Q&A pair from the analyzed screen
    const newQA: QAPair = {
      id: Date.now().toString(),
      question: 'Screen Analysis',
      answer,
      timestamp: new Date(),
      isStreaming: false,
    };

    setQAPairs(prev => [...prev, newQA]);
    setCurrentQAIndex(qaPairs.length);
    setShowAnswerWindow(true);
  };

  const handleOpenChat = () => {
    // TODO: Implement chat interface
  };

  const handleCloseAnswerWindow = async () => {
    // Resize window before hiding answer window
    await resizeWindowForState({
      hasTranscript: !!transcript,
      hasAnswerWindow: false,
    });
    setShowAnswerWindow(false);
  };

  const handleCloseApp = () => {
    window.electronAPI?.quitApp();
  };



  return (
    <div className="h-screen w-full bg-transparent overflow-hidden">
      {/* Header Overlay - Always visible */}
      <HeaderOverlay
        isRecording={isRecording}
        onToggleRecording={handleToggleRecording}
        onAIHelp={handleAIHelp}
        onAnalyzeScreen={handleAnalyzeScreen}
        onOpenChat={handleOpenChat}
        onClose={handleCloseApp}
        sessionTime={sessionTime}
      />

      {/* Transcription Bar - Shows when there's transcript */}
      {transcript && (
        <TranscriptionBar
          transcript={transcript}
          onClear={handleClearTranscript}
          onClose={handleClearTranscript}
        />
      )}

      {/* Answer Window - Shows when there are Q&A pairs */}
      {showAnswerWindow && qaPairs.length > 0 && (
        <AnswerWindow
          qaPairs={qaPairs}
          currentIndex={currentQAIndex}
          onNavigate={handleNavigateQA}
          onClear={handleClearQA}
          onClose={handleCloseAnswerWindow}
        />
      )}

      {/* Loading indicator */}
      {isModelLoading && (
        <div className="fixed bottom-4 right-4 bg-[#2A2A2A] px-4 py-3 rounded-lg shadow-xl border border-white/10">
          <p className="text-white text-sm">Loading Whisper model...</p>
        </div>
      )}

      {/* Error display */}
      {modelError && (
        <div className="fixed bottom-4 right-4 bg-red-500/20 border border-red-500 px-4 py-3 rounded-lg shadow-xl">
          <p className="text-red-200 text-sm">{modelError}</p>
        </div>
      )}

      {/* Analyze Screen Modal */}
      {showAnalyzeModal && (
        <AnalyzeScreenModal
          onClose={handleCloseAnalyzeModal}
          onAnalyze={handleAnalyzeComplete}
        />
      )}
    </div>
  );
}

export default App;
