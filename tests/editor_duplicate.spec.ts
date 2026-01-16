import { test, expect, helpers } from './fixtures.ts';
import { openContextMenu, loadInitialDirectory, expectMonacoEditorToBeFocused } from './helpers/sidebar_helpers.ts';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
    fsSetup.createFile('dir1', 'file1.txt', 'content1');
    fsSetup.createFile('dir1', 'folder1/nested_file.txt', 'nested content');
});

test('should duplicate file with correct name and content', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');
    const fileItem = page.locator('[data-file-path="file1.txt"]');

    // Open context menu
    await openContextMenu(page, fileItem);

    // Click Duplicate
    await page.getByTestId('ctx-duplicate').click();

    // Expect rename input with suggested name
    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('file1-2.txt');

    // Commit
    await page.keyboard.press('Enter');
    await expect(renameInput).not.toBeVisible();

    // Verify new file exists
    const newFile = page.locator('[data-file-path="file1-2.txt"]');
    await expect(newFile).toBeVisible();
    await expect(newFile).toHaveAttribute('data-selected', 'true');
    // Verify editor focused
    await expect(page.locator('.monaco-editor').first()).toHaveClass(/focused/);

    // Check editor content
    // We wait for content to be set
    await expect(async () => {
        const editorContent = await helpers.getEditorContent(page);
        expect(editorContent).toBe('content1');
    }).toPass();

    // Check content on disk
    const content = fsSetup.readFile('dir1', 'file1-2.txt');
    expect(content).toBe('content1');
});

test('should handle naming collisions linearly', async ({ page, fsSetup }) => {
    // Pre-create file1-2.txt
    fsSetup.createFile('dir1', 'file1-2.txt', 'content2');

    await loadInitialDirectory(page, 'dir1');
    const fileItem = page.locator('[data-file-path="file1.txt"]');

    await openContextMenu(page, fileItem);
    await page.getByTestId('ctx-duplicate').click();

    // Expect file1-3.txt
    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('file1-3.txt');

    await page.keyboard.press('Enter');
    await expect(page.locator('[data-file-path="file1-3.txt"]')).toBeVisible();
});

test('should cancel duplicate operation', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');
    const fileItem = page.locator('[data-file-path="file1.txt"]');

    await openContextMenu(page, fileItem);
    await page.getByTestId('ctx-duplicate').click();

    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toBeVisible();

    // Cancel
    await page.keyboard.press('Escape');

    await expect(renameInput).not.toBeVisible();
    await expect(page.locator('[data-file-path="file1-2.txt"]')).not.toBeVisible();

    // Verify focus returned to original file
    await expect(fileItem).toBeFocused();
});

test('should duplicate file in subdirectory', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = page.locator('[data-file-path="folder1/nested_file.txt"]');
    await expect(fileItem).toBeVisible();

    await openContextMenu(page, fileItem);
    await page.getByTestId('ctx-duplicate').click();

    const renameInput = page.getByTestId('rename-input');
    await expect(renameInput).toHaveValue('nested_file-2.txt');

    await page.keyboard.press('Enter');
    await expect(renameInput).not.toBeVisible();

    const newFile = page.locator('[data-file-path="folder1/nested_file-2.txt"]');
    await expect(newFile).toBeVisible();
    await expect(newFile).toHaveAttribute('data-selected', 'true');
    // Verify editor focused
    await expectMonacoEditorToBeFocused(page);

    // Check editor content
    // We wait for content to be set
    await expect(async () => {
        const editorContent = await helpers.getEditorContent(page);
        expect(editorContent).toBe('nested content');
    }).toPass();

    // Check content on disk
    const content = fsSetup.readFile('dir1', 'folder1/nested_file-2.txt');
    expect(content).toBe('nested content');
});
