
import { Page } from '@playwright/test';

export async function enableTestGlobals(page: Page) {
    await page.addInitScript(() => {
        window.__ENABLE_TEST_GLOBALS__ = true;
        window.__TEST_lastDialogMessage = null;

        window.__TEST_scheduleDialogAction = (action: 'confirm' | 'cancel') => {
            // Clear any existing interval to avoid conflicts
            if ((window as any).__TEST_dialogInterval) {
                clearInterval((window as any).__TEST_dialogInterval);
            }

            const startTime = Date.now();
            (window as any).__TEST_dialogInterval = setInterval(() => {
                // Timeout after 3 seconds
                if (Date.now() - startTime > 3000) {
                    clearInterval((window as any).__TEST_dialogInterval);
                    console.warn('__TEST_scheduleDialogAction: Timed out waiting for dialog');
                    return;
                }

                const dialog = window.__TEST_dialog; // Access exposed dialog store
                if (dialog && dialog.isOpen) {
                    // Capture message (helper might want to read it later)
                    // We can read from the store or DOM. Store is cleaner if available.
                    // But we can also look at the DOM for robustness.
                    // Let's use the DOM since our tests usually align with DOM.
                    const msgEl = document.querySelector('[data-testid="dialog-message"]');
                    if (msgEl) {
                        window.__TEST_lastDialogMessage = msgEl.textContent;
                    }

                    // Click the button
                    const btnSelector = action === 'confirm'
                        ? '[data-testid="dialog-confirm-button"]'
                        : '[data-testid="dialog-cancel-button"]';

                    const btn = document.querySelector(btnSelector) as HTMLButtonElement | null;
                    if (btn) {
                        btn.click();
                        clearInterval((window as any).__TEST_dialogInterval);
                    }
                }
            }, 50);
        };
    });
}

export async function waitForTestGlobals(page: Page) {
    await page.waitForFunction(() => window.__ENABLE_TEST_GLOBALS__ === true);
}
