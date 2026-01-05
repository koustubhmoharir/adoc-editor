import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FsTestSetup } from './helpers/fs_test_setup';
import { enableTestLogging } from './helpers/test_logging';

test.describe('Renaming Functionality', () => {
    let fsSetup: FsTestSetup;
    let dialogAction: 'accept' | 'dismiss' = 'accept';
    let lastDialogMessage = '';

    test.beforeEach(async ({ page }) => {
        dialogAction = 'accept'; // Reset default
        lastDialogMessage = '';
        enableTestLogging(page);

        // Custom dialog handler for the tests
        page.on('dialog', async dialog => {
            lastDialogMessage = dialog.message();
            if (dialogAction === 'accept') {
                await dialog.accept();
            } else {
                await dialog.dismiss();
            }
        });
        fsSetup = new FsTestSetup();
        fsSetup.createFile('dir1', 'file1.adoc', '== File 1 content');
        fsSetup.createFile('dir1', 'file2.adoc', '== File 2 content');
        fsSetup.createFile('dir1', 'conflict.adoc', '== Conflict File');
        await fsSetup.init(page);
        await page.goto('/?skip_restore=true');
        await page.waitForFunction(() => (window as any).__TEST_monaco !== undefined, null, { timeout: 10000 });
        await page.click('button:has-text("Open Folder")');
        await expect(page.locator('text=file1.adoc')).toBeVisible();
    });

    test.afterEach(() => {
        fsSetup.cleanup();
    });

    test('Enter and exit renaming via buttons', async ({ page }) => {
        // Select file using robust data-file-path locator
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click();

        // Verify selected state
        await expect(fileItem).toHaveClass(/selected/);

        // Click Rename button (pencil)
        await fileItem.hover();
        const renameBtn = fileItem.locator('[data-testid="rename-button"]');
        await expect(renameBtn).toBeVisible();
        await renameBtn.click();

        // Use the input itself to anchor, since it's unique during rename.
        const input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();

        // Rename
        await input.fill('newname.adoc');

        // Click Accept button (check)
        const acceptBtn = page.locator('[data-testid="accept-rename-button"]');
        await expect(acceptBtn).toBeVisible();
        await acceptBtn.click();

        // Verify rename
        // The file item should now have the new path
        await expect(page.locator('[data-testid="file-item"][data-file-path="newname.adoc"]')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'newname.adoc'))).toBe(true);
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'file1.adoc'))).toBe(false);
    });

    test('Enter and exit renaming via keyboard (F2, Enter)', async ({ page }) => {
        // Select file using robust selector
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click();
        await expect(fileItem).toHaveClass(/selected/);

        // Press F2
        await page.keyboard.press('F2');

        const input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();

        // Check selection (optional but good)
        // await expect(page.evaluate(() => document.getSelection()?.toString())).toBe('file1');

        await input.fill('renamed.adoc');
        await page.keyboard.press('Enter');

        await expect(page.locator('[data-testid="file-item"][data-file-path="renamed.adoc"]')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'renamed.adoc'))).toBe(true);
    });

    test('Cancel renaming via Esc', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click();
        await page.keyboard.press('F2');

        const input = page.locator('[data-testid="rename-input"]');
        await input.fill('aborted_change.adoc');

        await page.keyboard.press('Escape');

        // Input gone, old name remains
        await expect(input).not.toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'file1.adoc'))).toBe(true);
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'aborted_change.adoc'))).toBe(false);
    });

    test('Cancel renaming resets to original name if empty or same', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click();

        // 1. Same name
        await page.keyboard.press('F2');
        const input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(input).not.toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).toBeVisible();

        // 2. Empty name
        await page.keyboard.press('F2');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('');
        await page.keyboard.press('Enter');
        await expect(input).not.toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).toBeVisible();
    });

    test('Entering rename mode selects filename without extension', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click();
        await page.keyboard.press('F2');

        const input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();

        // Type 'changed' immediately. 
        // If "file1" was selected, input becomes "changed.adoc".
        await page.keyboard.type('changed');
        await page.keyboard.press('Enter');

        // Check result
        await expect(page.locator('[data-testid="file-item"][data-file-path="changed.adoc"]')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'changed.adoc'))).toBe(true);
    });

    test('Renaming preserves file content and editor content', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click();

        // Ensure content loaded
        await expect(async () => {
            const editorContent = await page.evaluate(() => (window as any).__TEST_editorStore.content);
            expect(editorContent).toBe('== File 1 content');
        }).toPass();

        // Rename
        await page.keyboard.press('F2');
        let input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('preserved.adoc');
        await page.keyboard.press('Enter');
        await expect(input).not.toBeVisible();

        // Verify editor content (should not reload or clear if not needed, but even if it reloads, it must be correct)
        await expect(async () => {
            const editorContent = await page.evaluate(() => (window as any).__TEST_editorStore.content);
            expect(editorContent).toBe('== File 1 content');
        }).toPass();

        // Verify disk content
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'preserved.adoc'), 'utf8');
        expect(content).toBe('== File 1 content');

        // Cancelled rename also preserves
        await page.keyboard.press('F2');
        input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('broken.adoc');
        await page.keyboard.press('Escape');

        await expect(async () => {
            const editorContent = await page.evaluate(() => (window as any).__TEST_editorStore.content);
            expect(editorContent).toBe('== File 1 content');
        }).toPass();
    });

    test('Renaming: Complex whitespace and dot handling', async ({ page }) => {
        // Helper to reset state
        const resetFile = async (currentName: string) => {
            const item = page.locator(`[data-testid="file-item"][data-file-path="${currentName}"]`);
            await item.click();
            await page.keyboard.press('F2');
            let input = page.locator('[data-testid="rename-input"]');
            await expect(input).toBeVisible();
            await expect(input).toBeFocused();
            await input.fill('file1.adoc');
            await page.keyboard.press('Enter');
            await expect(input).not.toBeVisible();
            await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]'), 'Failed to reset file to file1.adoc').toBeVisible();
        };

        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click();

        // 1. Leading dots: .config -> .config
        // Note: The logic will append .adoc if we don't provide it, because original handled .adoc
        // But .config usually doesn't have .adoc. 
        // Logic: if node.name.endsWith('.adoc') ...
        // file1.adoc ends with .adoc. So if we rename to .config, it becomes .config.adoc

        await page.keyboard.press('F2');
        let input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('.config');
        await page.keyboard.press('Enter');
        await expect(input).not.toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path=".config.adoc"]'), 'Failed to rename .config -> .config.adoc').toBeVisible();
        await resetFile('.config.adoc');

        // 2. Multiple dots: my..file.adoc -> my.file.adoc
        await page.keyboard.press('F2');
        input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('my..file.adoc');
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-testid="file-item"][data-file-path="my.file.adoc"]'), 'Failed to rename my..file.adoc -> my.file.adoc').toBeVisible();
        await resetFile('my.file.adoc');

        // 3. Spaces around dots: my . file . adoc -> my.file.adoc
        await page.keyboard.press('F2');
        input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('my . file . adoc');
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-testid="file-item"][data-file-path="my.file.adoc"]'), 'Failed to rename "my . file . adoc" -> my.file.adoc').toBeVisible();
        await resetFile('my.file.adoc');

        // 4. Empty parts: foo..bar -> foo.bar.adoc (appends extension)
        await page.keyboard.press('F2');
        input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('foo..bar');
        await page.keyboard.press('Enter');
        await expect(page.locator('[data-testid="file-item"][data-file-path="foo.bar.adoc"]'), 'Failed to rename foo..bar -> foo.bar.adoc').toBeVisible();
        await resetFile('foo.bar.adoc');

        // 5. Only dots: ... -> . (Disallowed -> Cancel)
        await page.keyboard.press('F2');
        input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('...');
        await page.keyboard.press('Enter');
        // Rename should cancel, input gone, original name remains
        await expect(input, 'Input did not disappear after disallowed rename').not.toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]'), 'Original file name not visible after disallowed rename').toBeVisible();
    });

    test('Validation: Unsafe characters', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click();
        await page.keyboard.press('F2');

        let input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('bad/name.adoc');
        await page.keyboard.press('Enter');

        await expect(async () => expect(lastDialogMessage).toContain('Invalid character')).toPass();

        await expect(page.locator('[data-testid="rename-input"]')).toBeVisible();
    });

    test('Validation: Conflict', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click();
        await page.keyboard.press('F2');

        // 1. Decline override
        dialogAction = 'dismiss';

        // Try renaming to existing 'conflict.adoc'
        let input = page.locator('[data-testid="rename-input"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await input.fill('conflict.adoc');
        await page.keyboard.press('Enter');

        // Should still be in rename mode (dialog dismissed)
        await expect(page.locator('[data-testid="rename-input"]')).toBeVisible();
        await expect(page.locator('[data-testid="rename-input"]')).toBeFocused();

        // 2. Accept override
        dialogAction = 'accept';

        // Retrigger
        await page.keyboard.press('Enter');

        // Should succeed now
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).not.toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path="conflict.adoc"]')).toBeVisible();

        // Mock implementation of move/rename simply renames the path on the handle.
        // Standard fs.renameSync does overwrite.
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'conflict.adoc'), 'utf8');
        expect(content).toBe('== File 1 content');
    });
});
