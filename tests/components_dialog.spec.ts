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
    await expect(page.getByTestId('dialog-result-true')).toHaveText('OK'); // Default button text
    // Cancel buttons should not be visible
    await expect(page.getByTestId('dialog-result-false')).not.toBeVisible();
    await expect(page.getByTestId('dialog-result-null')).not.toBeVisible();

    await page.getByTestId('dialog-result-true').click();
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
    await expect(page.getByTestId('dialog-result-true')).toHaveText('Understood');

    await page.getByTestId('dialog-result-true').click();
    await alertPromise;
    await expect(page.getByTestId('dialog-overlay')).not.toBeVisible();
});

test('confirm(message, options) should render correctly and resolve true/false', async ({ page }) => {
    let defaultTitle = helpers.defaultDialogTitle(page);
    // 1. Confirm with defaults
    let confirmPromise = dialogConfirm(page, 'Are you sure?');

    await expect(page.getByTestId('dialog-overlay')).toBeVisible();
    await expect(page.getByTestId('dialog-title')).toHaveText(defaultTitle);
    await expect(page.getByTestId('dialog-result-true')).toHaveText('Yes');
    await expect(page.getByTestId('dialog-result-false')).toHaveText('No');

    // Explicit cancel button shouldn't be visible by default
    await expect(page.getByTestId('dialog-result-null')).not.toBeVisible();

    // Icon should always be question for confirm
    await expect(page.getByTestId('dialog-icon')).toHaveClass(/fa-circle-question/);

    // Click No/Cancel (false) -> resolves false
    await page.getByTestId('dialog-result-false').click();
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
    await expect(page.getByTestId('dialog-result-true')).toHaveText('Delete!');
    await expect(page.getByTestId('dialog-result-false')).toHaveText('Keep it');

    // Click Confirm -> resolves true
    await page.getByTestId('dialog-result-true').click();
    result = await confirmPromise;
    expect(result).toBe(true);
    await expect(page.getByTestId('dialog-overlay')).not.toBeVisible();
});

test('confirm should support tri-state with cancel button', async ({ page }) => {
    // 1. Confirm with showCancel: true
    let confirmPromise = dialogConfirm(page, 'Save changes?', {
        yesText: 'Save',
        noText: 'Don\'t Save',
        showCancel: true,
        cancelText: 'Go Back'
    });

    await expect(page.getByTestId('dialog-overlay')).toBeVisible();
    await expect(page.getByTestId('dialog-result-true')).toHaveText('Save');
    await expect(page.getByTestId('dialog-result-false')).toHaveText('Don\'t Save');
    await expect(page.getByTestId('dialog-result-null')).toHaveText('Go Back');
    await expect(page.getByTestId('dialog-result-null')).toBeVisible();

    // Click Cancel (null) -> resolves null
    await page.getByTestId('dialog-result-null').click();
    let result = await confirmPromise;
    expect(result).toBe(null);
    await expect(page.getByTestId('dialog-overlay')).not.toBeVisible();
});


test('should handle multiple sequential dialogs', async ({ page }) => {
    // 1. Prepare the handlers in expected order
    // First dialog: Alert "First Call" -> OK (true)
    const handle1 = await helpers.handleNextDialog(page, true);

    // Second dialog: Confirm "Second Call" -> No (false)
    const handle2 = await helpers.handleNextDialog(page, false);

    // Third dialog: Confirm with Cancel "Third Call" -> Cancel (null)
    const handle3 = await helpers.handleNextDialog(page, null);

    // Fourth dialog: Alert "Fourth Call" -> OK (true)
    const handle4 = await helpers.handleNextDialog(page, true);

    // 2. Trigger the sequence of dialogs in the browser
    await page.evaluate((async () => {
        await window.__TEST_dialog.alert('First Call');

        const confirmResult = await window.__TEST_dialog.confirm('Second Call');
        if (confirmResult !== false) {
            throw new Error('Expected confirm to be false');
        }

        const cancelResult = await window.__TEST_dialog.confirm('Third Call', { showCancel: true });
        if (cancelResult !== null) {
            throw new Error('Expected confirm to be null (cancelled)');
        }

        await window.__TEST_dialog.alert('Fourth Call');
    }));

    // 3. Verify messages intercepted by handlers
    expect(await handle1.getMessage()).toBe('First Call');
    expect(await handle2.getMessage()).toBe('Second Call');
    expect(await handle3.getMessage()).toBe('Third Call');
    expect(await handle4.getMessage()).toBe('Fourth Call');
});
