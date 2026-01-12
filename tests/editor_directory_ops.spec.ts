import { helpers, test, expect } from './fixtures.ts';

// Helpers
import { getDirectoryItem, getRenameInput } from './helpers/locators.ts';
import { triggerRename, completeRename, cancelRename, loadInitialDirectory } from './helpers/sidebar_helpers.ts';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
    fsSetup.createDirectory('dir1', 'subdir1');
    fsSetup.createDirectory('dir1', 'subdir2');
    fsSetup.createFile('dir1', 'file_in_root.adoc', 'Root file content');
    fsSetup.createFile('dir1', 'subdir1/child.adoc', 'Child content');
});

test('Rename directory via Context Menu', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const dirItem = getDirectoryItem(page, 'subdir1');

    // Right clip + Rename
    await dirItem.click({ button: 'right' });
    await page.getByTestId('ctx-rename').click();

    await expect(getRenameInput(page)).toBeVisible();

    // Complete rename
    const input = getRenameInput(page);
    await completeRename(page, input, 'renamed_subdir');

    // Verify UI
    await expect(getDirectoryItem(page, 'renamed_subdir')).toBeVisible();
    await expect(getDirectoryItem(page, 'subdir1')).not.toBeVisible();

    // Verify FS
    expect(fsSetup.exists('dir1', 'renamed_subdir')).toBe(true);
    expect(fsSetup.exists('dir1', 'subdir1')).toBe(false);
    expect(fsSetup.exists('dir1', 'renamed_subdir/child.adoc')).toBe(true);
});

test('Rename directory via F2 key', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const dirItem = getDirectoryItem(page, 'subdir1');

    // Trigger via keyboard helper
    const input = await triggerRename(page, dirItem);

    await completeRename(page, input, 'keyboard_renamed');

    await expect(getDirectoryItem(page, 'keyboard_renamed')).toBeVisible();
    expect(fsSetup.exists('dir1', 'keyboard_renamed')).toBe(true);
});

test('Cancel directory rename', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const dirItem = getDirectoryItem(page, 'subdir1');
    const input = await triggerRename(page, dirItem); // Use F2 usually

    await cancelRename(page, input, 'aborted_rename');

    await expect(getDirectoryItem(page, 'subdir1')).toBeVisible();
    expect(fsSetup.exists('dir1', 'subdir1')).toBe(true);
    expect(fsSetup.exists('dir1', 'aborted_rename')).toBe(false);
});

test('Directory validation - Trim logic', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const dirItem = getDirectoryItem(page, 'subdir1');
    const input = await triggerRename(page, dirItem);

    // Enter name with spaces: "  spaced_dir  "
    // Per requirement: Trim only.
    await completeRename(page, input, '  spaced_dir  ');

    const expectedName = 'spaced_dir'; // Trimmed
    await expect(getDirectoryItem(page, expectedName)).toBeVisible();
    expect(fsSetup.exists('dir1', expectedName)).toBe(true);
});

test('Directory validation - Disallow dot only', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const dirItem = getDirectoryItem(page, 'subdir1');
    const input = await triggerRename(page, dirItem);

    // Enter "..."
    await completeRename(page, input, '...');

    // Should cancel/fail silently (revert to original) or fail based on logic. 
    // Logic says: `if (!finalName || /^[\.]+$/.test(finalName))` -> cancelRenaming.

    await expect(getDirectoryItem(page, 'subdir1')).toBeVisible();
    expect(fsSetup.exists('dir1', 'subdir1')).toBe(true);
});

test('Directory validation - Conflict', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const dirItem = getDirectoryItem(page, 'subdir1');
    const input = await triggerRename(page, dirItem);

    // Try renaming subdir1 -> subdir2
    await input.fill('subdir2');

    // Expect dialog
    const dialogHandle = await helpers.handleNextDialog(page, 'confirm');
    await page.keyboard.press('Enter');

    // Verify message
    expect(await dialogHandle.getMessage()).toContain('already exists');

    await page.keyboard.press('Escape');
    await expect(input).not.toBeVisible();
});
