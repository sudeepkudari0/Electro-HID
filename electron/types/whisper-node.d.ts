declare module 'whisper-node' {
    interface WhisperOptions {
        modelName: string;
        audioFile: string;
    }

    interface WhisperResult {
        speech: string;
    }

    function whisper(options: WhisperOptions): Promise<WhisperResult[]>;

    export = whisper;
}
