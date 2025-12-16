import { useState, useCallback, useRef } from 'react';
import { AudioRecorder } from './components/AudioRecorder/AudioRecorder';
import { TranscriptDisplay } from './components/TranscriptDisplay/TranscriptDisplay';
import { useWhisper } from './hooks/useWhisper';
import { useMixedAudioRecorder } from './hooks/useMixedAudioRecorder';

function App(): JSX.Element {
  const [transcript, setTranscript] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const lastProcessedChunkRef = useRef(0);

  const { isModelLoading, isModelLoaded, modelError, loadModel, transcribe } = useWhisper();

  // Real-time audio processing callback
  const handleAudioData = useCallback(async (chunks: Blob[]) => {
    console.log('handleAudioData called with', chunks.length, 'chunks');
    console.log('lastProcessedChunkRef.current:', lastProcessedChunkRef.current);
    console.log('isModelLoaded:', isModelLoaded);

    // Only process if we have new chunks
    if (chunks.length <= lastProcessedChunkRef.current) {
      console.log('Skipping - no new chunks');
      return;
    }

    if (!isModelLoaded) {
      console.log('Skipping - model not loaded');
      return;
    }

    setIsTranscribing(true);
    try {
      console.log('Processing audio - total chunks:', chunks.length, 'new:', chunks.length - lastProcessedChunkRef.current);

      // Combine ALL chunks into a single blob (not just new ones)
      // This is necessary because WebM chunks need the header from the first chunk
      const audioBlob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
      console.log('Total audio blob size:', audioBlob.size);

      // Convert blob to ArrayBuffer
      const arrayBuffer = await audioBlob.arrayBuffer();

      // Decode ALL audio data using Web Audio API
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Get ALL audio samples as Float32Array (mono channel)
      const allAudioData = audioBuffer.getChannelData(0);
      console.log('Total audio samples decoded:', allAudioData.length);

      // Calculate how many samples we've already processed
      // Assuming each chunk is roughly 3 seconds at 16kHz = 48000 samples
      const samplesPerChunk = 48000;
      const alreadyProcessedSamples = lastProcessedChunkRef.current * samplesPerChunk;

      // Extract only the NEW audio samples
      const newAudioData = allAudioData.slice(alreadyProcessedSamples);
      console.log('New audio samples to transcribe:', newAudioData.length);

      if (newAudioData.length === 0) {
        console.log('No new audio samples to process');
        lastProcessedChunkRef.current = chunks.length;
        return;
      }

      // Transcribe only the new portion in real-time
      const result = await transcribe(newAudioData);
      console.log('Real-time transcription result:', result);

      // Update the processed chunk count
      lastProcessedChunkRef.current = chunks.length;

      // Append to existing transcript
      if (result && result.trim()) {
        setTranscript(prev => prev ? `${prev} ${result}` : result);
      }
    } catch (error) {
      console.error('Failed to transcribe chunk:', error);
      // Don't show alert for real-time errors, just log them
    } finally {
      setIsTranscribing(false);
    }
  }, [isModelLoaded, transcribe]);

  const { isRecording, startRecording, stopRecording, clearChunks } = useMixedAudioRecorder(handleAudioData);

  const handleStart = async () => {
    try {
      // Load model if not loaded
      if (!isModelLoaded) {
        await loadModel();
      }

      // Reset state
      setTranscript('');
      lastProcessedChunkRef.current = 0;
      clearChunks();

      // Start recording
      await startRecording();
    } catch (error) {
      console.error('Failed to start:', error);
      alert('Failed to start: ' + (error as Error).message);
    }
  };

  const handleStop = () => {
    stopRecording();
    setIsTranscribing(false);
  };

  return (
    <div className="h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-purple-600/20 via-pink-500/20 to-blue-600/20">
      <div className="w-full max-w-2xl h-80 bg-black/40 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
        <div className="h-full flex flex-col p-6 gap-4">
          {/* Header with controls */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-white">Voice Transcription</h1>
            <AudioRecorder
              isRecording={isRecording}
              isModelLoading={isModelLoading}
              onStart={handleStart}
              onStop={handleStop}
            />
          </div>

          {/* Transcript display */}
          <TranscriptDisplay
            transcript={transcript}
            isLoading={isModelLoading}
            isTranscribing={isTranscribing}
            error={modelError}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
