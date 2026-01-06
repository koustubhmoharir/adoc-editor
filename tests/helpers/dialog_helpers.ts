
import { Page } from '@playwright/test';

declare global {
    interface Window {
        __TEST_scheduleDialogAction: (action: 'confirm' | 'cancel') => void;
        __TEST_lastDialogMessage: string | null;
        __TEST_dialogInterval: any;
    }
}

/**
 * Schedules a dialog action to be performed automatically when the dialog appears.
 * This function returns immediately. The action is performed by a script running in the browser.
 * 
 * @param page Playwright Page object
 * @param action The action to perform ('confirm' or 'cancel')
 * @returns A promise that resolves when the schedule command has been sent to the browser.
 */
export async function handleNextDialog(page: Page, action: 'confirm' | 'cancel' = 'confirm'): Promise<void> {
    await page.evaluate((act) => {
        window.__TEST_scheduleDialogAction(act);
    }, action);
}

/**
 * Retrieves the message of the last dialog that was handled by the scheduled action.
 * 
 * @param page Playwright Page object
 * @returns The message string
 */
export async function getLastDialogMessage(page: Page): Promise<string | null> {
    return await page.evaluate(() => {
        return window.__TEST_lastDialogMessage;
    });
}

/**
 * Clears the stored last dialog message.
 * 
 * @param page Playwright Page object
 */
export async function clearLastDialogMessage(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__TEST_lastDialogMessage = null;
    });
}
