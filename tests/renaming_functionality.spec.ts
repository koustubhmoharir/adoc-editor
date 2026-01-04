import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FsTestSetup } from './helpers/fs_test_setup';

test.describe('Renaming Functionality', () => {
    let fsSetup: FsTestSetup;
    let dialogAction: 'accept' | 'dismiss' = 'accept';

    test.beforeEach(async ({ page }) => {
        dialogAction = 'accept'; // Reset default
        page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
        page.on('pageerror', err => console.log(`BROWSER ERROR: ${err}`));
        page.on('dialog', async dialog => {
            console.log(`DIALOG: ${dialog.type()} "${dialog.message()}"`);
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
        // Select file by finding the file item container
        const fileItem = page.locator('div[class*="fileItem"]').filter({ hasText: 'file1.adoc' }).first();
        await fileItem.click();

        // Verify selected state
        await expect(fileItem).toHaveClass(/selected/);

        // Click Rename button (pencil)
        // Ensure visible (hover might be required if CSS hides it, though isSelected usually shows it)
        await fileItem.hover();
        const renameBtn = fileItem.locator('button[title="Rename (F2)"]');
        await expect(renameBtn).toBeVisible();
        await renameBtn.click();
        // The original fileItem locator relies on hasText: 'file1.adoc', which is now gone.
        // We need to find the file item that contains the rename input.
        // We use the input itself to anchor, since it's unique during rename.
        const input = page.locator('input[class*="renameInput"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();

        // Rename
        await input.fill('newname.adoc');

        // Click Accept button (check)
        // Use global locator since only one accept button exists during rename
        const acceptBtn = page.locator('button[title="Accept Rename"]');
        await expect(acceptBtn).toBeVisible();
        await acceptBtn.click();

        // Verify rename
        await expect(page.locator('text=newname.adoc')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'newname.adoc'))).toBe(true);
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'file1.adoc'))).toBe(false);
    });

    test('Enter and exit renaming via keyboard (F2, Enter)', async ({ page }) => {
        // Select file using robust selector
        const fileItem = page.locator('div[class*="fileItem"]').filter({ hasText: 'file1.adoc' }).first();
        await fileItem.click();
        await expect(fileItem).toHaveClass(/selected/);

        // Press F2
        await page.keyboard.press('F2');

        const input = page.locator('input[class*="renameInput"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();

        // Check selection (optional but good)
        // await expect(page.evaluate(() => document.getSelection()?.toString())).toBe('file1');

        await input.fill('renamed.adoc');
        await page.keyboard.press('Enter');

        await expect(page.locator('text=renamed.adoc')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'renamed.adoc'))).toBe(true);
    });

    test('Cancel renaming via Esc', async ({ page }) => {
        const fileItem = page.locator('div[class*="fileItem"]').filter({ hasText: 'file1.adoc' }).first();
        await fileItem.click();
        await page.keyboard.press('F2');

        const input = page.locator('input[class*="renameInput"]');
        await input.fill('aborted_change.adoc');

        await page.keyboard.press('Escape');

        // Input gone, old name remains
        await expect(input).not.toBeVisible();
        await expect(page.locator('text=file1.adoc')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'file1.adoc'))).toBe(true);
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'aborted_change.adoc'))).toBe(false);
    });

    test('Cancel renaming resets to original name if empty or same', async ({ page }) => {
        const fileItem = page.locator('div[class*="fileItem"]').filter({ hasText: 'file1.adoc' }).first();
        await fileItem.click();

        // 1. Same name
        await page.keyboard.press('F2');
        const input = page.locator('input[class*="renameInput"]');
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('input')).not.toBeVisible();
        await expect(page.locator('text=file1.adoc')).toBeVisible();

        // 2. Empty name
        await page.keyboard.press('F2');
        await page.locator('input').fill('');
        await page.keyboard.press('Enter');
        await expect(page.locator('input')).not.toBeVisible();
        await expect(page.locator('text=file1.adoc')).toBeVisible();
    });

    test('Entering rename mode selects filename without extension', async ({ page }) => {
        const fileItem = page.locator('div[class*="fileItem"]').filter({ hasText: 'file1.adoc' }).first();
        await fileItem.click();
        await page.keyboard.press('F2');

        // Type 'changed' immediately. 
        // If "file1" was selected, input becomes "changed.adoc".
        await page.keyboard.type('changed');
        await page.keyboard.press('Enter');

        // Check result
        await expect(page.locator('text=changed.adoc')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'changed.adoc'))).toBe(true);
    });

    test('Renaming preserves file content and editor content', async ({ page }) => {
        const fileItem = page.locator('div[class*="fileItem"]').filter({ hasText: 'file1.adoc' }).first();
        await fileItem.click();

        // Ensure content loaded
        await expect(async () => {
            const editorContent = await page.evaluate(() => (window as any).__TEST_editorStore.content);
            expect(editorContent).toBe('== File 1 content');
        }).toPass();

        // Rename
        await page.keyboard.press('F2');
        await page.locator('input[class*="renameInput"]').fill('preserved.adoc');
        await page.keyboard.press('Enter');

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
        await page.locator('input[class*="renameInput"]').fill('broken.adoc');
        await page.keyboard.press('Escape');

        await expect(async () => {
            const editorContent = await page.evaluate(() => (window as any).__TEST_editorStore.content);
            expect(editorContent).toBe('== File 1 content');
        }).toPass();
    });

    test('Renaming trims whitespace', async ({ page }) => {
        const fileItem = page.locator('div[class*="fileItem"]').filter({ hasText: 'file1.adoc' }).first();
        await fileItem.click();

        await page.keyboard.press('F2');
        await page.locator('input[class*="renameInput"]').fill('  trimmed.adoc  ');
        await page.keyboard.press('Enter');

        await expect(page.locator('text=trimmed.adoc')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'trimmed.adoc'))).toBe(true);
    });

    test('Validation: Unsafe characters', async ({ page }) => {
        const fileItem = page.locator('div[class*="fileItem"]').filter({ hasText: 'file1.adoc' }).first();
        await fileItem.click();
        await page.keyboard.press('F2');

        let msg = '';
        page.on('dialog', d => { msg = d.message(); d.accept(); });

        await page.locator('input[class*="renameInput"]').fill('bad/name.adoc');
        await page.keyboard.press('Enter');

        await expect(async () => expect(msg).toContain('Invalid character')).toPass();

        await expect(page.locator('input')).toBeVisible();
    });

    test('Validation: Conflict', async ({ page }) => {
        const fileItem = page.locator('div[class*="fileItem"]').filter({ hasText: 'file1.adoc' }).first();
        await fileItem.click();
        await page.keyboard.press('F2');

        // 1. Decline override
        dialogAction = 'dismiss';

        // Try renaming to existing 'conflict.adoc'
        await page.locator('input[class*="renameInput"]').fill('conflict.adoc');
        await page.keyboard.press('Enter');

        // Should still be in rename mode (dialog dismissed)
        await expect(page.locator('input')).toBeVisible();
        await expect(page.locator('input')).toBeFocused();

        // 2. Accept override
        dialogAction = 'accept';

        // Retrigger
        await page.keyboard.press('Enter');

        // Should succeed now
        await expect(page.locator('text=file1.adoc')).not.toBeVisible();
        await expect(page.locator('text=conflict.adoc')).toBeVisible();

        // Mock implementation of move/rename simply renames the path on the handle.
        // Standard fs.renameSync does overwrite.
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'conflict.adoc'), 'utf8');
        expect(content).toBe('== File 1 content');
    });
});
