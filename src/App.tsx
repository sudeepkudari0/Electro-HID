import { useState, useCallback, useRef, useEffect } from 'react';
import { HeaderOverlay } from './components/HeaderOverlay/HeaderOverlay';
import { TranscriptionBar } from './components/TranscriptionBar/TranscriptionBar';
import { AnswerWindow, QAPair } from './components/AnswerWindow/AnswerWindow';
import { useWhisper } from './hooks/useWhisper';
import { useMixedAudioRecorder } from './hooks/useMixedAudioRecorder';
import { useLLM } from './hooks/useLLM';

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

  // Hooks
  const { isModelLoading, isModelLoaded, modelError, loadModel, transcribe } = useWhisper();
  const { generateInterviewAnswer } = useLLM();

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
          console.log('Question detected:', transcript);
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

  const handleClearTranscript = () => {
    setTranscript('');
    lastTranscriptRef.current = '';
  };

  const handleClearQA = () => {
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

  const handleAnalyzeScreen = () => {
    // TODO: Implement screen analysis
    console.log('Analyze screen clicked');
  };

  const handleOpenChat = () => {
    // TODO: Implement chat interface
    console.log('Chat clicked');
  };

  // Control window click-through behavior
  // When only header is visible, window ignores mouse in transparent areas
  useEffect(() => {
    const updateClickThrough = async () => {
      try {
        const hasContent = transcript || showAnswerWindow;
        // When there's no content (only header), ignore mouse events in transparent areas
        await window.electronAPI.setIgnoreMouseEvents(!hasContent);
      } catch (error) {
        console.error('Failed to set ignore mouse events:', error);
      }
    };

    updateClickThrough();
  }, [transcript, showAnswerWindow]);



  return (
    <div className="h-screen w-full bg-transparent overflow-hidden">
      {/* Header Overlay - Always visible */}
      <HeaderOverlay
        isRecording={isRecording}
        onToggleRecording={handleToggleRecording}
        onAIHelp={handleAIHelp}
        onAnalyzeScreen={handleAnalyzeScreen}
        onOpenChat={handleOpenChat}
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
          onClose={() => setShowAnswerWindow(false)}
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
    </div>
  );
}

export default App;
