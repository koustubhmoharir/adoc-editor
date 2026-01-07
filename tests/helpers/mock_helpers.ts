import type { Page } from '@playwright/test';

/**
 * Configuration interface for the mock file picker.
 */
interface MockPickerConfig {
    name: string;
    path: string;
}

/**
 * Sets the mock configuration for the directory picker.
 * This allows simulating selecting different directories when `window.showDirectoryPicker` is called.
 * 
 * @param page - The Playwright Page object.
 * @param config - The configuration object containing name and path.
 */
export async function setMockPickerConfig(page: Page, config: MockPickerConfig): Promise<void> {
    await page.evaluate((cfg) => {
        window.__mockPickerConfig = cfg;
    }, config);
}
