import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface BenchmarkResult {
    mode: 'GPU' | 'CPU';
    timeMs: number;
    transcription: string;
    gpuDetected?: boolean;
}

function runWhisper(audioPath: string, useGpu: boolean): Promise<BenchmarkResult> {
    return new Promise((resolve, reject) => {
        const whisperExe = path.join(__dirname, '..', 'native', 'whisper', 'whisper.exe');
        const modelPath = path.join(__dirname, '..', 'native', 'whisper', 'models', 'ggml-base.en.bin');

        const args = [
            '-m', modelPath,
            '-f', audioPath,
            '-nt',
            '-l', 'en',
        ];

        // Add -ng flag to disable GPU (CPU mode)
        if (!useGpu) {
            args.push('-ng');
        }

        const startTime = Date.now();
        const proc = spawn(whisperExe, args, { windowsHide: true });

        let stdout = '';
        let stderr = '';
        let gpuDetected = false;

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            const text = data.toString();
            stderr += text;
            if (text.includes('CUDA') || text.includes('GPU') || text.includes('cuda')) {
                gpuDetected = true;
            }
        });

        proc.on('close', (code) => {
            const endTime = Date.now();
            const timeMs = endTime - startTime;

            if (code !== 0) {
                reject(new Error(`Whisper failed (${useGpu ? 'GPU' : 'CPU'}): ${stderr}`));
            } else {
                // Extract transcription
                const lines = stdout.split('\n');
                const transcriptionLines = lines.filter(line =>
                    !line.includes('[') && line.trim().length > 0
                );
                const transcription = transcriptionLines.join(' ').trim();

                resolve({
                    mode: useGpu ? 'GPU' : 'CPU',
                    timeMs,
                    transcription,
                    gpuDetected
                });
            }
        });

        proc.on('error', (error) => {
            reject(error);
        });
    });
}

async function benchmark(audioPath: string) {
    console.log('\n🎙️  Whisper GPU vs CPU Benchmark');
    console.log('=====================================\n');
    console.log(`Audio file: ${audioPath}\n`);

    try {
        // Test GPU
        console.log('⏱️  Testing GPU mode...');
        const gpuResult = await runWhisper(audioPath, true);
        const gpuStatus = gpuResult.gpuDetected ? '✅ GPU Detected' : '⚠️ GPU NOT DETECTED';
        console.log(`✓ GPU run completed in ${(gpuResult.timeMs / 1000).toFixed(2)}s  (${gpuStatus})\n`);

        // Test CPU
        console.log('⏱️  Testing CPU mode...');
        const cpuResult = await runWhisper(audioPath, false);
        console.log(`✓ CPU completed in ${(cpuResult.timeMs / 1000).toFixed(2)}s\n`);

        // Results
        console.log('=====================================');
        console.log('📊 RESULTS');
        console.log('=====================================\n');

        console.log(`GPU Time: ${(gpuResult.timeMs / 1000).toFixed(2)}s`);
        console.log(`CPU Time: ${(cpuResult.timeMs / 1000).toFixed(2)}s`);

        const speedup = cpuResult.timeMs / gpuResult.timeMs;
        const percentFaster = ((cpuResult.timeMs - gpuResult.timeMs) / cpuResult.timeMs * 100);

        console.log(`\n🚀 GPU is ${speedup.toFixed(2)}x faster`);
        console.log(`   (${percentFaster.toFixed(1)}% speed improvement)\n`);

        console.log('Transcription (GPU):');
        console.log(`  "${gpuResult.transcription.substring(0, 100)}..."\n`);

        // Verify both transcriptions match
        if (gpuResult.transcription === cpuResult.transcription) {
            console.log('✓ Transcriptions match (accuracy verified)');
        } else {
            console.log('⚠️  Transcriptions differ slightly');
        }

    } catch (error) {
        console.error('❌ Benchmark failed:', error);
        process.exit(1);
    }
}

import fs from 'fs';

// Look for audio file in test-data
const testDataDir = path.join(__dirname, '..', 'test-data');
let audioFile = process.argv[2];

if (!audioFile) {
    if (fs.existsSync(testDataDir)) {
        const files = fs.readdirSync(testDataDir);
        const audioExtensions = ['.wav', '.mp3', '.flac', '.ogg'];

        const foundFile = files.find(file =>
            audioExtensions.includes(path.extname(file).toLowerCase())
        );

        if (foundFile) {
            audioFile = path.join(testDataDir, foundFile);
            console.log(`✓ Auto-detected audio file: ${foundFile}`);
        }
    }
}

if (!audioFile) {
    console.log('Error: No audio file found!');
    console.log('\nPlease place an audio file (wav, mp3, flac, ogg) in:');
    console.log('  test-data/');
    console.log('\nOr provide path manually:');
    console.log('  bun run benchmark <audio-file>');
    process.exit(1);
}

benchmark(audioFile);
