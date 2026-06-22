/**
 * Question Detection Latency Benchmark
 * 
 * Replicates the EXACT real-app pipeline from App.tsx:
 *   1. filterHallucinations() — pre-filter
 *   2. EchoSuppressor.isEcho() — cross-channel dedup
 *   3. isQuestionSync() — question detection (9-signal scoring)
 *   4. classifyQuestion() — interview type classification
 *   5. findDuplicateIndex() — candidate dedup (store layer)
 * 
 * Run: bun run scripts/benchmark-question-detection.ts
 */

import { isQuestionSync, type DetectionResult } from '../src/lib/question-detector';
import { classifyQuestion } from '../src/lib/interview-classifier';
import { filterHallucinations } from '../src/lib/hallucination-filter';
import { EchoSuppressor } from '../src/lib/echo-suppressor';

// ─── Test Corpus ───
// Real interview utterances covering all detection paths

interface TestCase {
    text: string;
    speaker: 'interviewer' | 'user';
    expectedQuestion: boolean;
    expectedType?: string;
    category: string;
}

const TEST_CORPUS: TestCase[] = [
    // ── True Questions: Behavioral ──
    { text: "Tell me about a time when you had to deal with a difficult team member and how you resolved the conflict.", speaker: 'interviewer', expectedQuestion: true, expectedType: 'behavioral', category: 'behavioral' },
    { text: "Can you give me an example of a situation where you failed and what you learned from it?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'behavioral', category: 'behavioral' },
    { text: "Describe a challenge you faced in your last role and how you overcame it.", speaker: 'interviewer', expectedQuestion: true, expectedType: 'behavioral', category: 'behavioral' },
    { text: "Walk me through a time when you had to make a tough decision with limited information.", speaker: 'interviewer', expectedQuestion: true, expectedType: 'behavioral', category: 'behavioral' },

    // ── True Questions: Technical ──
    { text: "What is the difference between a promise and an observable in JavaScript?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'technical', category: 'technical' },
    { text: "How does the event loop work in Node.js?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'technical', category: 'technical' },
    { text: "Explain how React reconciliation works under the hood.", speaker: 'interviewer', expectedQuestion: true, expectedType: 'technical', category: 'technical' },
    { text: "What's the difference between useEffect and useLayoutEffect?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'technical', category: 'technical' },

    // ── True Questions: System Design ──
    { text: "How would you design a URL shortener that handles millions of users?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'system-design', category: 'system-design' },
    { text: "Design a real-time chat system with message persistence and high availability.", speaker: 'interviewer', expectedQuestion: true, expectedType: 'system-design', category: 'system-design' },
    { text: "Walk me through how you would architect a distributed caching layer.", speaker: 'interviewer', expectedQuestion: true, expectedType: 'system-design', category: 'system-design' },

    // ── True Questions: Coding ──
    { text: "Given an array of integers, find two numbers that add up to a target. What's the time complexity of your approach?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'coding', category: 'coding' },
    { text: "How would you implement a binary search on a sorted array?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'coding', category: 'coding' },
    { text: "Can you solve this using dynamic programming? What would the space complexity be?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'coding', category: 'coding' },

    // ── True Questions: HR Screening ──
    { text: "What are your salary expectations for this role?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'hr-screening', category: 'hr-screening' },
    { text: "Do you require visa sponsorship to work in this country?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'hr-screening', category: 'hr-screening' },
    { text: "What is your notice period at your current company?", speaker: 'interviewer', expectedQuestion: true, expectedType: 'hr-screening', category: 'hr-screening' },

    // ── True Questions: General / Edge ──
    { text: "Why are you interested in joining our company?", speaker: 'interviewer', expectedQuestion: true, category: 'general-question' },
    { text: "What would you say is your biggest strength?", speaker: 'interviewer', expectedQuestion: true, category: 'general-question' },
    { text: "Where do you see yourself in five years?", speaker: 'interviewer', expectedQuestion: true, category: 'general-question' },
    { text: "How do you handle pressure and tight deadlines?", speaker: 'interviewer', expectedQuestion: true, category: 'general-question' },

    // ── Not Questions: Acknowledgments ──
    { text: "Ok, that makes sense.", speaker: 'interviewer', expectedQuestion: false, category: 'acknowledgment' },
    { text: "Great, thanks for explaining that.", speaker: 'interviewer', expectedQuestion: false, category: 'acknowledgment' },
    { text: "Right.", speaker: 'interviewer', expectedQuestion: false, category: 'acknowledgment' },
    { text: "Interesting, I see.", speaker: 'interviewer', expectedQuestion: false, category: 'acknowledgment' },
    { text: "Got it.", speaker: 'interviewer', expectedQuestion: false, category: 'acknowledgment' },
    { text: "Perfect.", speaker: 'interviewer', expectedQuestion: false, category: 'acknowledgment' },
    { text: "Sure.", speaker: 'interviewer', expectedQuestion: false, category: 'acknowledgment' },
    { text: "Mm hmm.", speaker: 'interviewer', expectedQuestion: false, category: 'acknowledgment' },

    // ── Not Questions: Statements / Context ──
    { text: "So at our company we use a microservices architecture with Kubernetes.", speaker: 'interviewer', expectedQuestion: false, category: 'statement' },
    { text: "Let me tell you a bit about the team structure here.", speaker: 'interviewer', expectedQuestion: false, category: 'statement' },
    { text: "We have about 200 engineers across 15 teams.", speaker: 'interviewer', expectedQuestion: false, category: 'statement' },
    { text: "The role involves both frontend and backend work.", speaker: 'interviewer', expectedQuestion: false, category: 'statement' },

    // ── Not Questions: Filler / Short ──
    { text: "Uh", speaker: 'interviewer', expectedQuestion: false, category: 'filler' },
    { text: "So", speaker: 'interviewer', expectedQuestion: false, category: 'filler' },
    { text: "And", speaker: 'interviewer', expectedQuestion: false, category: 'filler' },

    // ── Hallucinations (should be filtered before detection) ──
    { text: "Thank you for watching and please subscribe.", speaker: 'interviewer', expectedQuestion: false, category: 'hallucination' },
    { text: "♪ ♫", speaker: 'interviewer', expectedQuestion: false, category: 'hallucination' },

    // ── User speech (echo suppressor path) ──
    { text: "I worked on a distributed system at my previous company using microservices.", speaker: 'user', expectedQuestion: false, category: 'user-speech' },
    { text: "Yes, I have experience with React and TypeScript.", speaker: 'user', expectedQuestion: false, category: 'user-speech' },
];

// ─── Pipeline (mirrors App.tsx exactly) ───

interface PipelineResult {
    hallucinationFiltered: boolean;
    echoSuppressed: boolean;
    detection: DetectionResult | null;
    interviewType: string | null;
    totalLatencyUs: number;  // microseconds
    stageLatencies: {
        hallucination: number;
        echo: number;
        detection: number;
        classification: number;
    };
}

function runPipeline(
    tc: TestCase,
    echoSuppressor: EchoSuppressor,
    existingCandidates: { text: string }[],
): PipelineResult {
    const result: PipelineResult = {
        hallucinationFiltered: false,
        echoSuppressed: false,
        detection: null,
        interviewType: null,
        totalLatencyUs: 0,
        stageLatencies: { hallucination: 0, echo: 0, detection: 0, classification: 0 },
    };

    const t0 = performance.now();

    // Stage 1: Hallucination filter (runs on ALL transcriptions in real app)
    const s1 = performance.now();
    const filterRes = filterHallucinations(tc.text);
    result.stageLatencies.hallucination = (performance.now() - s1) * 1000;

    if (!filterRes.valid) {
        result.hallucinationFiltered = true;
        result.totalLatencyUs = (performance.now() - t0) * 1000;
        return result;
    }

    // Stage 2: Echo suppression (only for interviewer channel in real app)
    const s2 = performance.now();
    if (tc.speaker === 'user') {
        echoSuppressor.recordUserTranscription(tc.text);
        result.stageLatencies.echo = (performance.now() - s2) * 1000;
        result.totalLatencyUs = (performance.now() - t0) * 1000;
        return result; // User speech doesn't go through question detection
    } else {
        const isEcho = echoSuppressor.isEcho(tc.text);
        result.stageLatencies.echo = (performance.now() - s2) * 1000;
        if (isEcho) {
            result.echoSuppressed = true;
            result.totalLatencyUs = (performance.now() - t0) * 1000;
            return result;
        }
        echoSuppressor.recordInterviewerTranscription(tc.text);
    }

    // Stage 3: Question detection (isQuestionSync — the core)
    const s3 = performance.now();
    result.detection = isQuestionSync(tc.text);
    result.stageLatencies.detection = (performance.now() - s3) * 1000;

    // Stage 4: Classification (only if question detected — mirrors handlePickQuestion)
    if (result.detection.isQuestion) {
        const s4 = performance.now();
        // Real app builds context from last 5 blocks; we simulate with just this text
        const contextTranscript = `Interviewer: ${tc.text}`;
        result.interviewType = classifyQuestion(contextTranscript);
        result.stageLatencies.classification = (performance.now() - s4) * 1000;
    }

    result.totalLatencyUs = (performance.now() - t0) * 1000;
    return result;
}

// ─── Stats helpers ───

function percentile(sorted: number[], p: number): number {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function formatUs(us: number): string {
    if (us < 1000) return `${us.toFixed(1)}µs`;
    return `${(us / 1000).toFixed(2)}ms`;
}

// ─── Main Benchmark ───

const ITERATIONS = 1000;

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║          Synapse AI — Question Detection Latency Bench         ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log(`\n  Corpus: ${TEST_CORPUS.length} utterances × ${ITERATIONS} iterations`);
console.log(`  Pipeline: hallucination → echo → detection → classification\n`);

// Warmup (5 iterations to prime JIT/regex caches)
for (let w = 0; w < 5; w++) {
    const es = new EchoSuppressor();
    for (const tc of TEST_CORPUS) runPipeline(tc, es, []);
}

// Collect results
const allLatencies: number[] = [];
const stageAgg = { hallucination: [] as number[], echo: [] as number[], detection: [] as number[], classification: [] as number[] };
const perCase: Map<number, { latencies: number[]; result: PipelineResult }> = new Map();

for (let i = 0; i < ITERATIONS; i++) {
    const echoSuppressor = new EchoSuppressor();
    const candidates: { text: string }[] = [];

    for (let j = 0; j < TEST_CORPUS.length; j++) {
        const tc = TEST_CORPUS[j];
        const res = runPipeline(tc, echoSuppressor, candidates);

        allLatencies.push(res.totalLatencyUs);
        stageAgg.hallucination.push(res.stageLatencies.hallucination);
        stageAgg.echo.push(res.stageLatencies.echo);
        stageAgg.detection.push(res.stageLatencies.detection);
        stageAgg.classification.push(res.stageLatencies.classification);

        if (!perCase.has(j)) perCase.set(j, { latencies: [], result: res });
        perCase.get(j)!.latencies.push(res.totalLatencyUs);

        if (res.detection?.isQuestion) candidates.push({ text: tc.text });
    }
}

// ─── Report: Aggregate Stats ───

allLatencies.sort((a, b) => a - b);
const avg = allLatencies.reduce((s, v) => s + v, 0) / allLatencies.length;

console.log('┌─────────────────────────────────────────────────────┐');
console.log('│  AGGREGATE LATENCY (full pipeline per utterance)    │');
console.log('├─────────────────────────────────────────────────────┤');
console.log(`│  Min:    ${formatUs(allLatencies[0]).padStart(10)}                              │`);
console.log(`│  Avg:    ${formatUs(avg).padStart(10)}                              │`);
console.log(`│  P50:    ${formatUs(percentile(allLatencies, 50)).padStart(10)}                              │`);
console.log(`│  P95:    ${formatUs(percentile(allLatencies, 95)).padStart(10)}                              │`);
console.log(`│  P99:    ${formatUs(percentile(allLatencies, 99)).padStart(10)}                              │`);
console.log(`│  Max:    ${formatUs(allLatencies[allLatencies.length - 1]).padStart(10)}                              │`);
console.log('└─────────────────────────────────────────────────────┘');

// ─── Report: Per-Stage Breakdown ───

console.log('\n┌─────────────────────────────────────────────────────┐');
console.log('│  PER-STAGE LATENCY (avg across all runs)            │');
console.log('├──────────────────┬──────────┬──────────┬────────────┤');
console.log('│ Stage            │   Avg    │   P95    │    Max     │');
console.log('├──────────────────┼──────────┼──────────┼────────────┤');

for (const [name, values] of Object.entries(stageAgg)) {
    const sorted = [...values].sort((a, b) => a - b);
    const stageAvg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const p95 = percentile(sorted, 95);
    const max = sorted[sorted.length - 1];
    console.log(`│ ${name.padEnd(16)} │ ${formatUs(stageAvg).padStart(8)} │ ${formatUs(p95).padStart(8)} │ ${formatUs(max).padStart(10)} │`);
}
console.log('└──────────────────┴──────────┴──────────┴────────────┘');

// ─── Report: Per-Utterance Detail ───

console.log('\n┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐');
console.log('│  PER-UTTERANCE RESULTS                                                                                                     │');
console.log('├────┬─────────────────────────────────────────────────────────┬───────┬──────────┬────────┬───────────────┬──────────┬─────────┤');
console.log('│ #  │ Utterance                                              │ Exp?  │ Got?     │ Match  │ Signals       │ Avg Lat  │ Type    │');
console.log('├────┼─────────────────────────────────────────────────────────┼───────┼──────────┼────────┼───────────────┼──────────┼─────────┤');

let correct = 0;
let total = 0;

for (let j = 0; j < TEST_CORPUS.length; j++) {
    const tc = TEST_CORPUS[j];
    const data = perCase.get(j)!;
    const res = data.result;
    const avgLat = data.latencies.reduce((s, v) => s + v, 0) / data.latencies.length;

    // Skip user speech and hallucinations from accuracy count
    const isFilteredOrUser = res.hallucinationFiltered || tc.speaker === 'user';
    const gotQuestion = res.detection?.isQuestion ?? false;
    const match = isFilteredOrUser ? !tc.expectedQuestion || !gotQuestion : gotQuestion === tc.expectedQuestion;

    if (!isFilteredOrUser) {
        total++;
        if (match) correct++;
    }

    const truncated = tc.text.length > 55 ? tc.text.slice(0, 52) + '...' : tc.text;
    const expStr = tc.expectedQuestion ? 'YES' : 'NO';
    const gotStr = isFilteredOrUser
        ? (res.hallucinationFiltered ? 'FILT' : 'USER')
        : (gotQuestion ? 'YES' : 'NO');
    const matchStr = isFilteredOrUser ? '  —' : (match ? ' ✅' : ' ❌');
    const signals = res.detection?.signals?.slice(0, 2).join(',') || '—';
    const typeStr = res.interviewType || '—';

    console.log(
        `│ ${String(j + 1).padStart(2)} │ ${truncated.padEnd(55)} │ ${expStr.padStart(5)} │ ${gotStr.padStart(8)} │ ${matchStr.padStart(5)}  │ ${signals.padEnd(13)} │ ${formatUs(avgLat).padStart(8)} │ ${typeStr.padEnd(7)} │`
    );
}

console.log('└────┴─────────────────────────────────────────────────────────┴───────┴──────────┴────────┴───────────────┴──────────┴─────────┘');

// ─── Accuracy Summary ───

const accuracy = total > 0 ? (correct / total * 100).toFixed(1) : '0';
console.log(`\n  Accuracy: ${correct}/${total} (${accuracy}%) on interviewer utterances`);
console.log(`  Total benchmark time: ${(allLatencies.reduce((s, v) => s + v, 0) / 1000).toFixed(1)}ms for ${allLatencies.length} pipeline runs\n`);
