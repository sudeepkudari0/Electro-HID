import { ElectronApplication, Page } from '@playwright/test';

/**
 * Helper to wait for IPC communication
 */
export async function waitForIPC(
    electronApp: ElectronApplication,
    channel: string,
    timeout = 5000
): Promise<any> {
    return electronApp.evaluate(
        async ({ ipcMain }, { channel, timeout }) => {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`IPC timeout waiting for ${channel}`));
                }, timeout);

                ipcMain.once(channel, (event, ...args) => {
                    clearTimeout(timer);
                    resolve(args);
                });
            });
        },
        { channel, timeout }
    );
}

/**
 * Helper to simulate microphone permission grant
 */
export async function grantMicrophonePermission(window: Page): Promise<void> {
    await window.context().grantPermissions(['microphone']);
}

/**
 * Helper to wait for model to load
 */
export async function waitForModelLoad(
    window: Page,
    timeout = 120000 // 2 minutes for first-time model download
): Promise<void> {
    // Wait for either loading indicator to disappear or error to appear
    await window.waitForFunction(
        () => {
            const loadingButton = document.querySelector('button:has-text("Loading Model")');
            const errorMessage = document.querySelector('.bg-destructive\\/10');
            const recordingIndicator = document.querySelector('text=Recording');

            return !loadingButton || errorMessage || recordingIndicator;
        },
        { timeout }
    );
}

/**
 * Helper to get console logs from Electron app
 */
export function setupConsoleCapture(window: Page): string[] {
    const logs: string[] = [];

    window.on('console', (msg) => {
        logs.push(`[${msg.type()}] ${msg.text()}`);
    });

    return logs;
}

/**
 * Helper to check if app is in recording state
 */
export async function isRecording(window: Page): Promise<boolean> {
    const stopButton = window.locator('button:has-text("Stop")');
    return await stopButton.isVisible();
}

/**
 * Helper to start recording with error handling
 */
export async function startRecording(
    window: Page,
    options: { waitForModel?: boolean; timeout?: number } = {}
): Promise<void> {
    const { waitForModel = true, timeout = 60000 } = options;

    const startButton = window.locator('button:has-text("Start Listening")');
    await startButton.click();

    if (waitForModel) {
        await waitForModelLoad(window, timeout);
    }

    // Verify recording started
    const recordingIndicator = window.locator('text=Recording');
    await recordingIndicator.waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Helper to stop recording
 */
export async function stopRecording(window: Page): Promise<void> {
    const stopButton = window.locator('button:has-text("Stop")');

    if (await stopButton.isVisible()) {
        await stopButton.click();

        // Wait for recording to stop
        await stopButton.waitFor({ state: 'hidden', timeout: 5000 });
    }
}

/**
 * Helper to clear transcript
 */
export async function clearTranscript(window: Page): Promise<void> {
    await stopRecording(window);
    const startButton = window.locator('button:has-text("Start Listening")');
    await startButton.waitFor({ state: 'visible' });
}

/**
 * Helper to get app metrics from main process
 */
export async function getAppMetrics(electronApp: ElectronApplication) {
    return electronApp.evaluate(async ({ app }) => {
        return {
            version: app.getVersion(),
            name: app.getName(),
            path: app.getPath('userData'),
        };
    });
}
