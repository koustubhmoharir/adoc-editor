import { test, expect } from '@playwright/test';
import { enableTestLogging } from './helpers/test_logging';
import { waitForTestGlobals } from './helpers/test_globals';

test.describe('Dialog API', () => {
    test.beforeEach(async ({ page }) => {
        enableTestLogging(page);
        // Inject flag to enable test globals
        await page.addInitScript(() => {
            window.__ENABLE_TEST_GLOBALS__ = true;
        });
        await page.goto('/?skip_restore=true');

        // Wait for dialog global
        await waitForTestGlobals(page);
    });

    test('alert(message, options) should render correctly and resolve on OK', async ({ page }) => {
        let defaultTitle = await page.evaluate(() => {
            return window.__TEST_dialog.defaultTitle;
        });
        // 1. Basic Alert
        let alertPromise = page.evaluate(() => {
            return window.__TEST_dialog.alert('Basic alert message');
        });

        await expect(page.getByTestId('dialog-overlay')).toBeVisible();
        await expect(page.getByTestId('dialog-title')).toHaveText(defaultTitle); // Default title
        await expect(page.getByTestId('dialog-message')).toHaveText('Basic alert message');
        await expect(page.getByTestId('dialog-confirm-button')).toHaveText('OK'); // Default button text
        await expect(page.getByTestId('dialog-cancel-button')).not.toBeVisible();

        await page.getByTestId('dialog-confirm-button').click();
        await alertPromise;
        await expect(page.getByTestId('dialog-overlay')).not.toBeVisible();

        // 2. Alert with Options (Title, Icon, Custom Button)
        alertPromise = page.evaluate(() => {
            return window.__TEST_dialog.alert('Error occurred', {
                title: 'Error Title',
                icon: 'error',
                okText: 'Understood'
            });
        });

        await expect(page.getByTestId('dialog-overlay')).toBeVisible();
        await expect(page.getByTestId('dialog-title')).toHaveText('Error Title');
        await expect(page.getByTestId('dialog-message')).toHaveText('Error occurred');

        // Verify Icon (Error)
        // Note: We check for classes. Dialog component applies 'fa-solid fa-circle-exclamation' for error.
        const icon = page.getByTestId('dialog-icon');
        await expect(icon).toBeVisible();
        await expect(icon).toHaveClass(/fa-circle-exclamation/);

        // Verify Custom Button
        await expect(page.getByTestId('dialog-confirm-button')).toHaveText('Understood');

        await page.getByTestId('dialog-confirm-button').click();
        await alertPromise;
        await expect(page.getByTestId('dialog-overlay')).not.toBeVisible();
    });

    test('confirm(message, options) should render correctly and resolve true/false', async ({ page }) => {
        let defaultTitle = await page.evaluate(() => {
            return window.__TEST_dialog.defaultTitle;
        });
        // 1. Confirm with defaults
        let confirmPromise = page.evaluate(() => {
            return window.__TEST_dialog.confirm('Are you sure?');
        });

        await expect(page.getByTestId('dialog-overlay')).toBeVisible();
        await expect(page.getByTestId('dialog-title')).toHaveText(defaultTitle);
        await expect(page.getByTestId('dialog-confirm-button')).toHaveText('OK');
        await expect(page.getByTestId('dialog-cancel-button')).toHaveText('Cancel');

        // Icon should always be question for confirm
        await expect(page.getByTestId('dialog-icon')).toHaveClass(/fa-circle-question/);

        // Click Cancel -> resolves false
        await page.getByTestId('dialog-cancel-button').click();
        let result = await confirmPromise;
        expect(result).toBe(false);
        await expect(page.getByTestId('dialog-overlay')).not.toBeVisible();

        // 2. Confirm with Options
        confirmPromise = page.evaluate(() => {
            return window.__TEST_dialog.confirm('Delete data?', {
                title: 'Unsafe Action',
                yesText: 'Delete!',
                noText: 'Keep it'
            });
        });

        await expect(page.getByTestId('dialog-overlay')).toBeVisible();
        await expect(page.getByTestId('dialog-title')).toHaveText('Unsafe Action');
        await expect(page.getByTestId('dialog-confirm-button')).toHaveText('Delete!');
        await expect(page.getByTestId('dialog-cancel-button')).toHaveText('Keep it');

        // Click Confirm -> resolves true
        await page.getByTestId('dialog-confirm-button').click();
        result = await confirmPromise;
        expect(result).toBe(true);
        await expect(page.getByTestId('dialog-overlay')).not.toBeVisible();
    });
});
