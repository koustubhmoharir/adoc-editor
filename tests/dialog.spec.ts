import { Page } from '@playwright/test';
import { test, expect, helpers } from './fixtures.ts';
import type { AlertOptions, ConfirmOptions } from '../src/components/Dialog.tsx';

function dialogAlert(page: Page, message: string, options?: AlertOptions) {
    return page.evaluate(({ message, options }) => {
        return window.__TEST_dialog.alert(message, options);
    }, { message, options });
}

function dialogConfirm(page: Page, message: string, options?: ConfirmOptions) {
    return page.evaluate(({ message, options }) => {
        return window.__TEST_dialog.confirm(message, options);
    }, { message, options });
}

test('alert(message, options) should render correctly and resolve on OK', async ({ page }) => {
    let defaultTitle = helpers.defaultDialogTitle(page);
    // 1. Basic Alert

    let alertPromise = dialogAlert(page, 'Basic alert message');

    await expect(page.getByTestId('dialog-overlay')).toBeVisible();
    await expect(page.getByTestId('dialog-title')).toHaveText(defaultTitle); // Default title
    await expect(page.getByTestId('dialog-message')).toHaveText('Basic alert message');
    await expect(page.getByTestId('dialog-confirm-button')).toHaveText('OK'); // Default button text
    await expect(page.getByTestId('dialog-cancel-button')).not.toBeVisible();

    await page.getByTestId('dialog-confirm-button').click();
    await alertPromise;
    await expect(page.getByTestId('dialog-overlay')).not.toBeVisible();

    // 2. Alert with Options (Title, Icon, Custom Button)
    alertPromise = dialogAlert(page, 'Error occurred', {
        title: 'Error Title',
        icon: 'error',
        okText: 'Understood'
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
    let defaultTitle = helpers.defaultDialogTitle(page);
    // 1. Confirm with defaults
    let confirmPromise = dialogConfirm(page, 'Are you sure?');

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
    confirmPromise = dialogConfirm(page, 'Delete data?', {
        title: 'Unsafe Action',
        yesText: 'Delete!',
        noText: 'Keep it'
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


test('should handle multiple sequential dialogs', async ({ page }) => {
    // 1. Prepare the handlers in expected order
    // First dialog: Alert "First Call" -> OK
    const handle1 = await helpers.handleNextDialog(page, 'confirm');

    // Second dialog: Confirm "Second Call" -> Cancel
    const handle2 = await helpers.handleNextDialog(page, 'cancel');

    // Third dialog: Alert "Third Call" -> OK
    const handle3 = await helpers.handleNextDialog(page, 'confirm');

    // 2. Trigger the sequence of dialogs in the browser
    await page.evaluate((async () => {
        await window.__TEST_dialog.alert('First Call');

        const confirmResult = await window.__TEST_dialog.confirm('Second Call');
        if (confirmResult !== false) {
            throw new Error('Expected confirm to be cancelled (false)');
        }

        await window.__TEST_dialog.alert('Third Call');
    }));

    // 3. Verify messages intercepted by handlers
    expect(await handle1.getMessage()).toBe('First Call');
    expect(await handle2.getMessage()).toBe('Second Call');
    expect(await handle3.getMessage()).toBe('Third Call');
});