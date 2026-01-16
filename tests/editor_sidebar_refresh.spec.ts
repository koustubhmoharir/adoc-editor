import { test, expect, helpers } from './fixtures';
import { getDirectoryItem } from './helpers/locators';
import { loadInitialDirectory, openContextMenu } from './helpers/sidebar_helpers';

test.describe('Refresh Features', () => {

    test.beforeEach(async ({ fsSetup }) => {
        fsSetup.cleanup();
        fsSetup.createFile('dir1', 'file1.txt', 'content1');
        fsSetup.createFile('dir1', 'sub/fileInSub.txt', 'content in sub');
        fsSetup.createFile('dir1', 'outside.txt', 'outside content');
    });

    test('F5 Global Refresh: updates content and preserves open file', async ({ page, fsSetup }) => {
        await loadInitialDirectory(page, 'dir1');

        // Open 'file1.txt'
        await page.click('[data-file-path="file1.txt"]');
        await expect(async () => {
            const content = await helpers.getEditorContent(page);
            expect(content).toBe('content1');
        }).toPass();

        // 1. Modify file 'file1.txt' externally
        fsSetup.createFile('dir1', 'file1.txt', 'content1-modified');

        // 2. Add a new file externally
        fsSetup.createFile('dir1', 'new-file.txt', 'new content');

        // 3. Press F5
        await page.keyboard.press('F5');

        // Verify content updated
        await expect(async () => {
            const content = await helpers.getEditorContent(page);
            expect(content).toBe('content1-modified');
        }).toPass();

        // Verify new file visible
        await expect(page.locator('[data-file-path="new-file.txt"]')).toBeVisible();

        // Verify focus/highlight (F5 on file should keep file highlighted)
        await expect(page.locator('[data-file-path="file1.txt"]')).toHaveAttribute('data-selected', 'true');
    });

    test('F5 Directory Refresh: updates subdirectory and maintains selection', async ({ page, fsSetup }) => {
        await loadInitialDirectory(page, 'dir1');

        // Open 'sub/fileInSub.txt'
        const subDir = page.locator('[data-dir-path="sub"]');
        await subDir.click(); // Expand/Select 'sub'
        await page.click('[data-file-path="sub/fileInSub.txt"]'); // Open file

        // Ensure file content loaded
        await expect(async () => {
            expect(await helpers.getEditorContent(page)).toBe('content in sub');
        }).toPass();

        // Select 'sub' directory again to set context
        await subDir.click();
        await expect(subDir).toHaveAttribute('data-selected', 'true');

        // 1. Modify 'sub/fileInSub.txt' externally
        fsSetup.createFile('dir1', 'sub/fileInSub.txt', 'content in sub modified');

        // 2. Add new file in 'sub'
        fsSetup.createFile('dir1', 'sub/new-in-sub.txt', 'new sub content');

        // 3. Press F5
        await page.keyboard.press('F5');

        // Verify 'sub' is STILL selected
        await expect(subDir).toHaveAttribute('data-selected', 'true');

        // Verify content updated in editor (since it was open and inside the refreshed dir)
        await expect(async () => {
            expect(await helpers.getEditorContent(page)).toBe('content in sub modified');
        }).toPass();

        // Verify new file in sub visible
        await expect(page.locator('[data-file-path="sub/new-in-sub.txt"]')).toBeVisible();
    });

    test('Context Menu Refresh: behaves same as F5 Directory Refresh', async ({ page, fsSetup }) => {
        await loadInitialDirectory(page, 'dir1');

        // Open 'sub/fileInSub.txt'
        await page.click('[data-dir-path="sub"]');
        await page.click('[data-file-path="sub/fileInSub.txt"]');

        const subDir = page.locator('[data-dir-path="sub"]');

        // Select sub dir
        await subDir.click();

        // Modify externally
        fsSetup.createFile('dir1', 'sub/fileInSub.txt', 'context menu modified');

        // Right click sub dir -> Refresh
        await openContextMenu(page, subDir);
        await page.getByTestId('ctx-refresh').click();

        // Verify 'sub' is STILL selected
        await expect(subDir).toHaveAttribute('data-selected', 'true');

        // Verify content updated
        await expect(async () => {
            expect(await helpers.getEditorContent(page)).toBe('context menu modified');
        }).toPass();
    });

    test('Refresh Isolation: Refreshing directory does NOT reload outside file', async ({ page, fsSetup }) => {
        await loadInitialDirectory(page, 'dir1');

        // Open 'outside.txt'
        await page.click('[data-file-path="outside.txt"]');
        await expect(async () => {
            expect(await helpers.getEditorContent(page)).toBe('outside content');
        }).toPass();

        // Select 'sub' directory
        const subDir = page.locator('[data-dir-path="sub"]');
        await subDir.click();
        await expect(subDir).toHaveAttribute('data-selected', 'true');

        // Modify 'outside.txt' externally
        fsSetup.createFile('dir1', 'outside.txt', 'outside modified');

        // Press F5 (with 'sub' selected)
        await page.keyboard.press('F5');

        // Verify 'sub' is selected
        await expect(subDir).toHaveAttribute('data-selected', 'true');

        // Verify content did NOT update (because we refreshed only 'sub')
        // Note: Realistically, if we didn't refresh the root, we wouldn't see the change.
        // Wait a bit to ensure no async update happens
        await page.waitForTimeout(500);

        const content = await helpers.getEditorContent(page);
        expect(content).toBe('outside content');

        // Now do a global refresh (F5 with file selected or root selected)
        // Let's click root
        await getDirectoryItem(page, '').click();
        await page.keyboard.press('F5');

        await expect(async () => {
            expect(await helpers.getEditorContent(page)).toBe('outside modified');
        }).toPass();
    });
});
