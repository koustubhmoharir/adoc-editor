import { test, expect } from '@playwright/test';
import { enableTestLogging } from './helpers/test_logging';
import { waitForTestGlobals, handleNextDialog, enableTestGlobals } from './helpers/test_globals';

test.describe('Helper: handleNextDialog', () => {
    test.beforeEach(async ({ page }) => {
        enableTestLogging(page);
        // Set up dialog helpers (exposes __TEST_onDialogHandled and injects scheduleDialogAction)
        await enableTestGlobals(page);

        // Inject flag to enable test globals in the app
        await page.addInitScript(() => {
            window.__ENABLE_TEST_GLOBALS__ = true;
        });
        await page.goto('/?skip_restore=true');

        // Wait for dialog global
        await waitForTestGlobals(page);
    });

    test('should handle multiple sequential dialogs', async ({ page }) => {
        // 1. Prepare the handlers in expected order
        // First dialog: Alert "First Call" -> OK
        const handle1 = await handleNextDialog(page, 'confirm');

        // Second dialog: Confirm "Second Call" -> Cancel
        const handle2 = await handleNextDialog(page, 'cancel');

        // Third dialog: Alert "Third Call" -> OK
        const handle3 = await handleNextDialog(page, 'confirm');

        // 2. Trigger the sequence of dialogs in the browser
        await page.evaluate(async () => {
            const d = window.__TEST_dialog;

            await d.alert('First Call');

            const confirmResult = await d.confirm('Second Call');
            if (confirmResult !== false) {
                throw new Error('Expected confirm to be cancelled (false)');
            }

            await d.alert('Third Call');
        });

        // 3. Verify messages intercepted by handlers
        expect(await handle1.getMessage()).toBe('First Call');
        expect(await handle2.getMessage()).toBe('Second Call');
        expect(await handle3.getMessage()).toBe('Third Call');
    });
});
