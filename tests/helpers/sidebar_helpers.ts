
import { Page, Locator, expect } from '@playwright/test';
import { FsTestSetup } from './fs_test_setup';
import { getFileItem, getRenameInput } from './locators';
import { setMockPickerConfig } from './mock_helpers';

export async function triggerRename(page: Page, fileItem: Locator): Promise<Locator> {
    await fileItem.click();
    await expect(fileItem).toHaveAttribute('data-selected', 'true');

    await fileItem.press('F2');

    const input = getRenameInput(page);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    return input;
}

export async function completeRename(page: Page, input: Locator, newName: string, method: 'enter' | 'button' = 'enter') {
    await input.fill(newName);

    if (method === 'button') {
        const acceptBtn = page.locator('[data-testid="accept-rename-button"]');
        await expect(acceptBtn).toBeVisible();
        await acceptBtn.click();
    } else {
        await page.keyboard.press('Enter');
    }

    await expect(input).not.toBeVisible();
}

export async function cancelRename(page: Page, input: Locator, inputContent?: string) {
    if (inputContent !== undefined) {
        await input.fill(inputContent);
    }
    await page.keyboard.press('Escape');
    await expect(input).not.toBeVisible();
}

export async function verifyRenameOnFocusChange(
    page: Page,
    fsSetup: FsTestSetup,
    originalName: string,
    newName: string,
    triggerFocusChange: () => Promise<void>
) {
    const fileItem = getFileItem(page, originalName);
    await fileItem.click();
    await expect(fileItem).toHaveAttribute('data-selected', 'true');

    const input = await triggerRename(page, fileItem);
    await input.fill(newName);

    // Trigger the focus change
    await triggerFocusChange();

    // Verify input is gone
    await expect(input).not.toBeVisible();

    // Verify new name exists
    await expect(getFileItem(page, newName)).toBeVisible();
    expect(fsSetup.exists('dir1', newName)).toBe(true);
    // Verify old name gone
    await expect(getFileItem(page, originalName)).not.toBeVisible();
    expect(fsSetup.exists('dir1', originalName)).toBe(false);
}

export async function loadInitialDirectory(page: Page, dir: string) {
    await setMockPickerConfig(page, dir);
    // Open the test directory
    const openDirBtn = page.locator('data-testid=open-folder-button');
    await openDirBtn.click();

    // Wait for tree to populate
    await expect(page.locator('data-testid=file-item').first()).toBeVisible();
}

