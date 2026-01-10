import type { Page } from '@playwright/test';

/**
 * Sets the mock configuration for the directory picker.
 * This allows simulating selecting different directories when `window.showDirectoryPicker` is called.
 * 
 * @param page - The Playwright Page object.
 * @param config - The configuration object containing name and path.
 */
export async function setMockPickerConfig(page: Page, dirName: string): Promise<void> {
    await page.evaluate((dirName) => {
        window.__TEST_mockPickerConfig = { name: dirName, path: dirName };
    }, dirName);
}
