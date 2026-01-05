import { Page } from '@playwright/test';

/**
 * Enables logging for the Playwright test page if the DEBUG_TESTS environment variable is set.
 * logs console messages, errors, and dialog interactions.
 * 
 * @param page The Playwright Page object.
 */
export function enableTestLogging(page: Page) {
    if (process.env.DEBUG_TESTS) {
        page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
        page.on('pageerror', err => console.log(`BROWSER ERROR: ${err}`));
        page.on('dialog', async dialog => {
            console.log(`DIALOG: ${dialog.type()} "${dialog.message()}"`);
        });
    }
}
