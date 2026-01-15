import { test, expect } from './fixtures';
import { loadInitialDirectory, openContextMenu } from './helpers/sidebar_helpers';

test.describe('Sidebar Refresh', () => {

    test.beforeEach(async ({ fsSetup }) => {
        fsSetup.cleanup();
        fsSetup.createFile('dir1', 'file1.txt', 'content1');
        fsSetup.createFile('dir1', 'sub/fileInSub.txt', 'content in sub');
    });

    test('should refresh subdirectory and show new externally added file', async ({ page, fsSetup }) => {
        await loadInitialDirectory(page, 'dir1');

        // Expand subdirectory
        const subDir = page.locator('[data-dir-path="sub"]');
        await subDir.click();
        await expect(page.locator('[data-file-path="sub/fileInSub.txt"]')).toBeVisible();

        // Simulate external file creation
        // We use backend to create file, frontend doesn't know about it yet
        fsSetup.createFile('dir1', 'sub/external.txt', 'external content');

        // Verify NOT visible yet (unless auto-refresh exists, which it doesn't)
        await expect(page.locator('[data-file-path="sub/external.txt"]')).not.toBeVisible();

        // Right-click subdir and refresh
        const contextMenu = await openContextMenu(page, subDir);

        await expect(contextMenu).toContainText('Refresh');

        await page.getByTestId('ctx-refresh').click();

        // Verify NEW file is visible
        await expect(page.locator('[data-file-path="sub/external.txt"]')).toBeVisible();
    });

    test('should refresh root directory and show new externally added file', async ({ page, fsSetup }) => {
        await loadInitialDirectory(page, 'dir1');

        // Verify initial state
        await expect(page.locator('[data-file-path="file1.txt"]')).toBeVisible();

        // Simulate external file creation in ROOT
        fsSetup.createFile('dir1', 'root_external.txt', 'root content');

        // Verify NOT visible yet
        await expect(page.locator('[data-file-path="root_external.txt"]')).not.toBeVisible();

        // Right-click ROOT (header)
        const header = page.getByTestId('sidebar-header');
        const contextMenu = await openContextMenu(page, header);

        // Note: Logic for root context menu should also include Refresh?
        // Wait, did I add it to root? 
        // SidebarContextMenu uses `targetNode?.kind === 'directory'`.
        // Root is a directory. So it should be there.
        await expect(contextMenu).toContainText('Refresh');

        await page.getByTestId('ctx-refresh').click();

        // Verify NEW file is visible
        await expect(page.locator('[data-file-path="root_external.txt"]')).toBeVisible();
    });
});
