import { test, expect } from './fixtures.ts';
import { loadInitialDirectory } from './helpers/sidebar_helpers.ts';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
    // Reset and setup basic file system using FsTestSetup class
    fsSetup.createFile('dir1', 'file1.txt', 'content1');
    fsSetup.createFile('dir1', 'folder1/nested_file.txt', 'nested content');
});

test('should show context menu for file with correct options', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');
    const fileItem = page.locator('[data-file-path="file1.txt"]');
    await fileItem.click({ button: 'right' });

    // Verify context menu appears
    const contextMenu = page.locator('[data-testid="sidebar-contextmenu"]');
    await expect(contextMenu).toBeVisible();

    // Verify options
    await expect(contextMenu).toContainText('Open');
    await expect(contextMenu).toContainText('Rename');
    await expect(contextMenu).toContainText('Delete');
    await expect(contextMenu).not.toContainText('New File');

    await fileItem.click();
    await expect(contextMenu).not.toBeVisible();
});

test('should show context menu for directory with correct options', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const dirItem = page.locator('[data-dir-path="folder1"]');
    await dirItem.click({ button: 'right' });

    // Verify context menu appears
    const contextMenu = page.getByTestId('sidebar-contextmenu');
    await expect(contextMenu).toBeVisible();

    // Verify options
    await expect(contextMenu).toContainText('New File');
    await expect(contextMenu).toContainText('New Directory'); // Added
    await expect(contextMenu).not.toContainText('Open');
    await expect(contextMenu).toContainText('Rename');
    await expect(contextMenu).toContainText('Delete');

    await dirItem.click();
    await expect(contextMenu).not.toBeVisible();
});

test('should trigger rename from context menu', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = page.locator('[data-file-path="file1.txt"]');
    await fileItem.click({ button: 'right' });

    const renameBtn = page.getByTestId('ctx-rename');
    await renameBtn.click();

    // Verify rename input appears
    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('file1.txt');

    await page.keyboard.press('Escape');
    await expect(renameInput).not.toBeVisible();
});

test('should trigger rename from context menu for directory', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const dirItem = page.locator('[data-dir-path="folder1"]');
    await dirItem.click({ button: 'right' });

    const renameBtn = page.getByTestId('ctx-rename');
    await renameBtn.click();

    // Verify rename input appears
    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('folder1');

    await page.keyboard.press('Escape');
    await expect(renameInput).not.toBeVisible();
});

test('should create new file from context menu', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const dirItem = page.locator('[data-dir-path="folder1"]');
    await dirItem.click({ button: 'right' });

    const newFileBtn = page.getByTestId('ctx-new-file');
    await newFileBtn.click();

    // The input for renaming the new file should appear
    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toBeVisible();

    // Should focus and select input (implied by functionality, but we just check visibility)
    // We can check if it starts with "new-"
    await expect(renameInput).toHaveValue(/^new-\d+$/);

    await page.keyboard.press('Escape');
    await expect(renameInput).not.toBeVisible();
});

test('should navigate context menu items with arrow keys', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = page.locator('[data-file-path="file1.txt"]');
    const contextMenu = page.getByTestId('sidebar-contextmenu');
    await expect(contextMenu).not.toBeVisible();

    await fileItem.click({ button: 'right' });

    await expect(contextMenu).toBeVisible();

    // Interaction:
    // Press ArrowDown -> First item (Open) should be focused
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('ctx-open')).toBeFocused();

    // Press ArrowDown -> Second item (Rename) should be focused
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('ctx-rename')).toBeFocused();

    // Press ArrowDown -> Third item (Delete) should be focused
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('ctx-delete')).toBeFocused();

    // Loop around
    // Press ArrowDown -> First item (Open) should be focused
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('ctx-open')).toBeFocused();

    // Go backwards
    // Press ArrowUp -> Last item (Delete) should be focused
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('ctx-delete')).toBeFocused();

    await fileItem.click();
    await expect(contextMenu).not.toBeVisible();
});

test('should execute action with Enter key', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = page.locator('[data-file-path="file1.txt"]');
    await fileItem.click({ button: 'right' });

    // Navigate to Rename
    await page.keyboard.press('ArrowDown'); // Focus Open
    await page.keyboard.press('ArrowDown'); // Focus Rename

    await expect(page.getByTestId('ctx-rename')).toBeFocused();

    // Press Enter
    await page.keyboard.press('Enter');

    // Check rename input appears
    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('file1.txt');

    await page.keyboard.press('Escape');
    await expect(renameInput).not.toBeVisible();
});

test('should show context menu for root directory', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    // Header select
    const header = page.getByTestId('sidebar-header');
    await header.click({ button: 'right' });

    const contextMenu = page.getByTestId('sidebar-contextmenu');
    await expect(contextMenu).toBeVisible();

    // Verify options
    await expect(contextMenu).toContainText('New File');
    await expect(contextMenu).toContainText('New Directory');
    await expect(contextMenu).not.toContainText('Rename');
    await expect(contextMenu).not.toContainText('Delete');
});
// Uncomment the tests below when we make improvements to directory creation
// test('should create new directory from context menu', async ({ page }) => {
//     await loadInitialDirectory(page, 'dir1');

//     const header = page.getByTestId('sidebar-header');
//     await header.click({ button: 'right' });

//     await page.getByTestId('ctx-new-directory').click();

//     // Expect rename input for new directory
//     const renameInput = page.getByTestId('rename-input');
//     await expect(renameInput).toBeVisible();
//     await expect(renameInput).toHaveValue(/^new-folder-\d+$/);

//     // Commit rename
//     await renameInput.fill('my_new_folder');
//     await page.keyboard.press('Enter');

//     // Verify existence
//     await expect(page.locator('[data-dir-path="my_new_folder"]')).toBeVisible();
// });

// test('should create new directory in subdirectory', async ({ page, fsSetup }) => {
//     await loadInitialDirectory(page, 'dir1');

//     // Select folder1
//     const dirItem = page.locator('[data-dir-path="folder1"]');
//     // Ensure expanded if needed? loadInitialDirectory usually expands? No, just loads root.
//     // Double click to toggle expand if needed, but context menu works regardless.

//     await dirItem.click({ button: 'right' });
//     await page.getByTestId('ctx-new-directory').click();

//     const renameInput = page.getByTestId('rename-input');
//     await expect(renameInput).toBeVisible();

//     await renameInput.fill('sub_folder');
//     await page.keyboard.press('Enter');

//     // We might need to expand folder1 to see it if it wasn't expanded.
//     // The createNewDirectory implementation deletes from collapsedPaths (expands parent).
//     await expect(page.locator('[data-dir-path="folder1/sub_folder"]')).toBeVisible();
//     expect(fsSetup.exists('dir1', 'folder1/sub_folder')).toBe(true);
// });
