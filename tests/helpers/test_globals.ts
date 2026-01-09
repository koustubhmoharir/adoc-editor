
import { Page } from '@playwright/test';

interface DialogHandle {
    getMessage: () => Promise<string>;
}

type DialogHandlersQueue = ((msg: string) => void)[];

// Equivalent of a module-level queue on the Playwright side (node)
// It stores pending handlers that we have created but not yet fulfilled by the browser.
// It needs to be maintained per page and reset when the page refreshes.
const handlersQueue: WeakMap<Page, DialogHandlersQueue> = new WeakMap();
function getOrCreateQueue(page: Page) {
    let queue = handlersQueue.get(page);
    if (queue == null) {
        queue = [];
        handlersQueue.set(page, queue);

        page.on("framenavigated", frame => {
            if (frame === page.mainFrame()) {
                handlersQueue.set(page, []);
            }
        });
    }
    return queue;
}

/**
 * Schedules a dialog action to be performed automatically when the dialog appears.
 * Returns a handler object that can be used to synchronously retrieve the dialog message
 * *after* the UI action has completed.
 * 
 * @param page Playwright Page object
 * @param action The action to perform ('confirm' or 'cancel')
 * @returns An object with a getMessage() method.
 */
export async function handleNextDialog(page: Page, action: 'confirm' | 'cancel' = 'confirm'): Promise<DialogHandle> {
    let capturedMessage: string | undefined;

    // Create a promise that will be resolved when the exposed onDialogHandled is called
    getOrCreateQueue(page).push(msg => { capturedMessage = msg; });

    // Schedule the action in the browser
    await page.evaluate((act) => {
        (window as any).__TEST_scheduleDialogAction(act);
    }, action);

    return {
        getMessage: async () => {
            await page.evaluate(() => { }); // Give the browser a chance to act on the dialog
            if (capturedMessage === undefined) {
                throw new Error("Dialog action was expected but the dialog callback was never invoked. This usually means the action did not trigger a dialog as expected.");
            }
            return capturedMessage;
        }
    };
}

export async function enableTestGlobals(page: Page) {

    function onDialogHandled(message: string) {
        const queue = getOrCreateQueue(page);
        const handler = queue.shift();
        if (handler) {
            handler(message);
        } else {
            console.warn('onDialogHandled called but no handler was waiting in the queue.');
        }
    }
    
    // Expose the handler function to the browser context
    await page.exposeFunction('__TEST_onDialogHandled', onDialogHandled);

    await page.addInitScript(() => {
        window.__ENABLE_TEST_GLOBALS__ = true;
        const dialogActionsQueue: ('confirm' | 'cancel')[] = [];
        let dialogInterval: number | null = null;

        (window as any).__TEST_scheduleDialogAction = (action: 'confirm' | 'cancel') => {
            dialogActionsQueue.push(action);

            // Start the watcher loop only if not already running
            if (dialogInterval) return;

            dialogInterval = window.setInterval(() => {
                const dialog = window.__TEST_dialog;

                // Stop if queue empty
                if (dialogActionsQueue.length === 0) {
                    if (dialogInterval != null) {
                        clearInterval(dialogInterval);
                        dialogInterval = null;
                    }
                    return;
                }

                // If dialog is open and we have a pending action
                if (dialog.isOpen) {
                    const action = dialogActionsQueue.shift(); // Get next action

                    // Capture message via DOM for consistency
                    const msgEl = document.querySelector('[data-testid="dialog-message"]');
                    const message = msgEl ? msgEl.textContent : '';

                    // Notify Playwright
                    (window as any).__TEST_onDialogHandled(message);

                    // Perform action
                    const btnSelector = action === 'confirm'
                        ? '[data-testid="dialog-confirm-button"]'
                        : '[data-testid="dialog-cancel-button"]';

                    const btn = document.querySelector(btnSelector) as HTMLButtonElement | null;
                    if (btn) {
                        btn.click();
                    } else {
                        console.error(`__TEST_scheduleDialogAction: Button ${action} not found`);
                    }
                }
            }, 50);
        };
    });
}

export async function waitForTestGlobals(page: Page) {
    await page.waitForFunction(() => window.__ENABLE_TEST_GLOBALS__ === true);
}
