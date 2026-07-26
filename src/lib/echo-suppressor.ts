/**
 * EchoSuppressor — Cross-channel echo detection for dual-audio capture.
 *
 * Problem:
 *   When Electron captures system audio via `chromeMediaSource: 'desktop'`,
 *   it picks up ALL audio output — including the user's own voice echoed back
 *   from the meeting app (e.g. Zoom, Meet, Teams). This causes the same speech
 *   to be transcribed twice: once correctly as 'user' from the mic, and again
 *   incorrectly as 'interviewer' from the system audio.
 *
 * Solution:
 *   Track recent transcriptions from each channel with timestamps. When a new
 *   system-audio (interviewer) transcription arrives, compare it against recent
 *   user transcriptions within a time window. If the text is sufficiently
 *   similar (fuzzy match), suppress it as an echo.
 *
 * The suppression is asymmetric: we only suppress system audio echoes of user
 * speech, never the reverse. The mic stream with echoCancellation enabled is
 * the source of truth for user speech.
 */

export interface TranscriptionEntry {
    text: string;
    timestamp: number;   // Date.now() when transcription was received
    source: 'user' | 'interviewer';
}

/**
 * Tuning constants.
 *
 * ECHO_WINDOW_MS: Maximum time gap (ms) between a user transcription and a
 *   system-audio transcription for them to be considered potential echoes.
 *   Meeting apps typically echo back audio with 200-2000ms of delay depending
 *   on codec, buffering, and network latency.
 *
 * SIMILARITY_THRESHOLD: Minimum normalized similarity score (0-1) for two
 *   transcriptions to be considered the same speech. 0.6 is tuned to catch
 *   echoes even when Whisper produces slightly different wording for the same
 *   audio from different channels.
 */
const ECHO_WINDOW_MS = 3000; // Reduced from 8000 to prevent false-positives on conversational turn-taking
const SIMILARITY_THRESHOLD = 0.70; // Increased from 0.55 to be more precise
const CONTAINMENT_THRESHOLD = 0.85; // Increased from 0.70 to require stronger overlap

// Short utterances (e.g. conversational acknowledgments like "ok", "yeah")
// need much stricter constraints because they are highly common in natural conversation.
const SHORT_UTTERANCE_WORD_COUNT = 3;
const SHORT_UTTERANCE_WINDOW_MS = 1500;
const SHORT_UTTERANCE_SIMILARITY_THRESHOLD = 0.85;

/**
 * Normalize text for comparison: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, '')   // strip punctuation
        .replace(/\s+/g, ' ')     // collapse whitespace
        .trim();
}

/**
 * Compute word-level Jaccard similarity between two strings.
 * Returns a value between 0 (completely different) and 1 (identical).
 *
 * We use word-level (not character-level) comparison because STT engines
 * may produce slightly different punctuation or spacing for the same audio.
 */
function wordSimilarity(a: string, b: string): number {
    const wordsA = new Set(normalize(a).split(' ').filter(w => w.length > 0));
    const wordsB = new Set(normalize(b).split(' ').filter(w => w.length > 0));

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const word of wordsA) {
        if (wordsB.has(word)) intersection++;
    }

    const union = wordsA.size + wordsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Check if text B is substantially contained within text A.
 * This catches cases where the echo is a subset of the original
 * (e.g. system audio only catches part of the user's utterance).
 */
function containmentScore(container: string, candidate: string): number {
    const containerWords = normalize(container).split(' ').filter(w => w.length > 0);
    const candidateWords = normalize(candidate).split(' ').filter(w => w.length > 0);

    if (candidateWords.length === 0) return 0;
    if (containerWords.length === 0) return 0;

    const containerSet = new Set(containerWords);
    let matched = 0;
    for (const word of candidateWords) {
        if (containerSet.has(word)) matched++;
    }

    return matched / candidateWords.length;
}

export class EchoSuppressor {
    private recentUserTranscriptions: TranscriptionEntry[] = [];
    private recentInterviewerTranscriptions: TranscriptionEntry[] = [];
    private suppressionCount = 0;

    /**
     * Record a user transcription for echo comparison.
     */
    recordUserTranscription(text: string): void {
        this.recentUserTranscriptions.push({
            text,
            timestamp: Date.now(),
            source: 'user',
        });
        this.pruneOldEntries();
    }

    /**
     * Check if an interviewer transcription is likely an echo of recent user speech.
     *
     * @param text - The interviewer transcription to check
     * @returns true if this should be SUPPRESSED (it's an echo), false if it's genuine
     */
    isEcho(text: string): boolean {
        const now = Date.now();
        this.pruneOldEntries();

        const words = normalize(text).split(' ').filter(w => w.length > 0);
        const isShort = words.length <= SHORT_UTTERANCE_WORD_COUNT;

        // Compare against all recent user transcriptions within the echo window
        for (const userEntry of this.recentUserTranscriptions) {
            const timeDelta = now - userEntry.timestamp;
            
            // Determine the maximum window based on whether the utterance is short
            const maxWindow = isShort ? SHORT_UTTERANCE_WINDOW_MS : ECHO_WINDOW_MS;
            if (timeDelta > maxWindow) continue;

            // Check similarity
            const similarity = wordSimilarity(text, userEntry.text);

            if (isShort) {
                // Short utterances must be highly similar and have a tight time window
                if (similarity >= SHORT_UTTERANCE_SIMILARITY_THRESHOLD) {
                    this.suppressionCount++;
                    console.log(
                        `[EchoSuppressor] SUPPRESSED interviewer echo (short utterance) ` +
                        `(similarity=${similarity.toFixed(2)}, delta=${timeDelta}ms): "${text.slice(0, 80)}..."`
                    );
                    return true;
                }
            } else {
                const containment = containmentScore(userEntry.text, text);
                // Either high overall similarity OR most of the interviewer text
                // is contained in a recent user transcription
                if (similarity >= SIMILARITY_THRESHOLD || containment >= CONTAINMENT_THRESHOLD) {
                    this.suppressionCount++;
                    console.log(
                        `[EchoSuppressor] SUPPRESSED interviewer echo ` +
                        `(similarity=${similarity.toFixed(2)}, containment=${containment.toFixed(2)}, ` +
                        `delta=${timeDelta}ms): "${text.slice(0, 80)}..."`
                    );
                    return true;
                }
            }
        }

        // Also check: if the interviewer text is very similar to another recent
        // interviewer transcription (duplicate system audio chunk), suppress it
        for (const prevEntry of this.recentInterviewerTranscriptions) {
            const timeDelta = now - prevEntry.timestamp;
            if (timeDelta > 3000) continue; // Tighter window for same-channel dedup

            const similarity = wordSimilarity(text, prevEntry.text);
            if (similarity >= 0.8) {
                console.log(
                    `[EchoSuppressor] SUPPRESSED duplicate interviewer chunk ` +
                    `(similarity=${similarity.toFixed(2)}, delta=${timeDelta}ms)`
                );
                return true;
            }
        }

        return false;
    }

    /**
     * Record an interviewer transcription that passed the echo check
     * (for same-channel dedup).
     */
    recordInterviewerTranscription(text: string): void {
        this.recentInterviewerTranscriptions.push({
            text,
            timestamp: Date.now(),
            source: 'interviewer',
        });
        this.pruneOldEntries();
    }

    /**
     * Remove entries older than the echo window to prevent unbounded growth.
     */
    private pruneOldEntries(): void {
        const cutoff = Date.now() - ECHO_WINDOW_MS * 2;
        this.recentUserTranscriptions = this.recentUserTranscriptions.filter(
            e => e.timestamp > cutoff
        );
        this.recentInterviewerTranscriptions = this.recentInterviewerTranscriptions.filter(
            e => e.timestamp > cutoff
        );
    }

    /** Get total number of suppressions for debugging. */
    getSuppressionCount(): number {
        return this.suppressionCount;
    }

    /** Reset all state. */
    clear(): void {
        this.recentUserTranscriptions = [];
        this.recentInterviewerTranscriptions = [];
        this.suppressionCount = 0;
    }
}
