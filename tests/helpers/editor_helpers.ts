import type { Page } from '@playwright/test';

/**
 * Sets the content of the Monaco editor using keyboard interactions.
 * This simulates a user selecting all text and typing new content.
 * 
 * @param page - The Playwright Page object.
 * @param content - The new content to set in the editor.
 */
export async function setEditorContent(page: Page, content: string): Promise<void> {
    // Click the editor to focus it
    await page.click('.monaco-editor');
    // Select all content
    await page.keyboard.press('Control+A');
    // Type the new content
    await page.keyboard.type(content);
}

/**
 * Retrieves the current content from the editor store.
 * 
 * @param page - The Playwright Page object.
 * @returns The current content of the editor.
 */
export async function getEditorContent(page: Page): Promise<string> {
    return await page.evaluate(() => window.__TEST_editorStore.content);
}

/**
 * Disables the auto-save functionality in the editor.
 * Useful for testing manual save scenarios or verifying dirty state.
 * 
 * @param page - The Playwright Page object.
 */
export async function disableAutoSave(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__TEST_DISABLE_AUTO_SAVE__ = true;
    });
}
