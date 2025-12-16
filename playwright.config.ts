import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30000,
    fullyParallel: false, // Electron apps should run sequentially
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Run one test at a time for Electron
    reporter: 'html',

    use: {
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        {
            name: 'electron',
            testMatch: '**/*.spec.ts',
        },
    ],
});
