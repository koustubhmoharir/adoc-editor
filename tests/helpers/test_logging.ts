import { Page } from '@playwright/test';

/**
 * Enables logging for the Playwright test page if the DEBUG_TESTS environment variable is set.
 * logs console messages, errors, and dialog interactions.
 * 
 * @param page The Playwright Page object.
 */
export function enableTestLogging(page: Page) {
    page.on('pageerror', err => console.log(`BROWSER EXCEPTION: ${err}`));
    page.on('console', msg => {
        const t = msg.type();
        if (t === 'error') {
            console.error(`BROWSER: ${msg.text()}`);
        }
        if (t === 'warning') {
            console.warn(`BROWSER: ${msg.text()}`);
        }
        if (process.env.DEBUG_TESTS) {
            console.log(`BROWSER: ${msg.text()}`);
        }
    });
    if (process.env.DEBUG_TESTS) {
        page.on('dialog', async dialog => {
            console.log(`DIALOG: ${dialog.type()} "${dialog.message()}"`);
        });
    }
}
