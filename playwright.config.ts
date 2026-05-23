import { defineConfig, devices } from '@playwright/test';
import { SERVER_URL } from './scripts/devserver.config.ts';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : 2,
    reporter: 'line',
    globalSetup: './tests/global_setup.ts',
    use: {
        baseURL: SERVER_URL,
        trace: 'on-first-retry',
        // trace: 'off',
        video: 'off',
        screenshot: 'off'
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'pnpm run serve',
        url: SERVER_URL,
        reuseExistingServer: true,
    },
});
