import { request, expect } from '@playwright/test';

async function globalSetup() {
    const rebuildUrl = 'http://127.0.0.1:8001/_rebuild';
    const maxRetries = 20;

    // 1. Wait for server to be ready
    let serverReady = false;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await request.newContext().then(ctx => ctx.post(rebuildUrl));
            if (response.ok()) {
                serverReady = true;
                break;
            }
        } catch (e) {
            // server not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (!serverReady) {
        throw new Error(`Server at ${rebuildUrl} is not ready after ${maxRetries} retries.`);
    }

    // 2. Trigger rebuild if dirty
    console.log('Checking for rebuild...');
    const response = await request.newContext().then(ctx => ctx.post(rebuildUrl));
    expect(response.ok()).toBeTruthy();
    console.log('Rebuild check complete:', await response.text());
}

export default globalSetup;
