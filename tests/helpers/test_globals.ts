
import { Page } from '@playwright/test';

export async function enableTestGlobals(page: Page) {
    await page.addInitScript('window.__ENABLE_TEST_GLOBALS__ = true;');
}

export async function waitForTestGlobals(page: Page) {
    await page.waitForFunction(() => window.__ENABLE_TEST_GLOBALS__ === true);
}
