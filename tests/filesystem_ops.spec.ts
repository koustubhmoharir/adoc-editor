import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FsTestSetup } from './helpers/fs_test_setup';
import { enableTestLogging } from './helpers/test_logging';
import { waitForTestGlobals } from './helpers/test_globals';
import { handleNextDialog, getLastDialogMessage } from './helpers/dialog_helpers';

test.describe('Renaming Functionality', () => {
    let fsSetup: FsTestSetup;
    test.beforeEach(async ({ page }) => {
        enableTestLogging(page);

        fsSetup = new FsTestSetup();
        fsSetup.createFile('dir1', 'file1.adoc', '== File 1 content');
        fsSetup.createFile('dir1', 'file2.adoc', '== File 2 content');
        fsSetup.createFile('dir1', 'conflict.adoc', '== Conflict File');
        await fsSetup.init(page);
        await page.goto('/?skip_restore=true');
        await waitForTestGlobals(page);
        await page.waitForFunction(() => window.__TEST_monaco !== undefined, null, { timeout: 10000 });
        await page.click('button:has-text("Open Folder")');
        await expect(page.locator('text=file1.adoc')).toBeVisible();
    });

    test.afterEach(() => {
        fsSetup.cleanup();
    });

    test('Enter and exit renaming via buttons', async ({ page }) => {
        // Select file using robust data-file-path locator
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');

        // Use helper to trigger rename via button
        const input = await triggerRename(page, fileItem, 'button');

        // Rename and complete via button
        await completeRename(page, input, 'newname.adoc', 'button');

        // Verify rename
        // The file item should now have the new path
        await expect(page.locator('[data-testid="file-item"][data-file-path="newname.adoc"]')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'newname.adoc'))).toBe(true);
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'file1.adoc'))).toBe(false);
    });

    test('Enter and exit renaming via keyboard (F2, Enter)', async ({ page }) => {
        // Select file using robust selector
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');

        // Use helper to trigger rename via F2
        const input = await triggerRename(page, fileItem, 'f2');

        // Rename and complete via Enter
        await completeRename(page, input, 'renamed.adoc', 'enter');

        await expect(page.locator('[data-testid="file-item"][data-file-path="renamed.adoc"]')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'renamed.adoc'))).toBe(true);
    });

    test('Cancel renaming via Esc', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        const input = await triggerRename(page, fileItem, 'f2');

        await cancelRename(page, input, 'aborted_change.adoc');

        // Input gone, old name remains
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'file1.adoc'))).toBe(true);
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'aborted_change.adoc'))).toBe(false);
    });

    test('Cancel renaming resets to original name if empty or same', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');

        // 1. Same name (Use helper, defaults to F2 trigger, Enter completion)
        let input = await triggerRename(page, fileItem);
        // We can't use completeRename here strictly if we don't change text, OR we can just pass empty string/same content?
        // completeRename fills newName.
        // Wait, completeRename fills newName. I should probably just manually press enter if I want "no change".
        // Or make completeRename handle it.
        // Actually, if I pass 'file1.adoc' (original name), it should work. But it might not simulate "typing nothing".
        // Let's modify the test to leverage the helper as much as possible, or fallback to manual if helper is too restrictive.
        // But the user asked for helper to enter/exit.

        // Case 1: Same name (simulate just pressing enter on current name?) or typing same name?
        // The original test just pressed Enter immediately without typing.
        // completeRename does fill().
        await input.press('Enter');
        await expect(input).not.toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).toBeVisible();

        // 2. Empty name
        input = await triggerRename(page, fileItem);
        await completeRename(page, input, '');
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).toBeVisible();
    });

    test('Entering rename mode selects filename without extension', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await triggerRename(page, fileItem);

        // Type 'changed' immediately to verify selection handling
        // We can't use completeRename here because we want to test that specific typing behavior (or verify selection first).
        // BUT completeRename does .fill(), which overwrites.
        // The original test was: `await page.keyboard.type('changed');` to prove selection was active.
        // I will do that here manually as it's a specific interaction test.
        await page.keyboard.type('changed');
        await page.keyboard.press('Enter');

        // Check result
        await expect(page.locator('[data-testid="file-item"][data-file-path="changed.adoc"]')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'changed.adoc'))).toBe(true);
    });

    test('Renaming preserves file content and editor content', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        await fileItem.click(); // Ensure selection for content load check first

        // Ensure content loaded
        await expect(async () => {
            const editorContent = await page.evaluate(() => window.__TEST_editorStore.content);
            expect(editorContent).toBe('== File 1 content');
        }).toPass();

        // Rename
        const input = await triggerRename(page, fileItem);
        await completeRename(page, input, 'preserved.adoc');

        // Verify editor content
        await expect(async () => {
            const editorContent = await page.evaluate(() => window.__TEST_editorStore.content);
            expect(editorContent).toBe('== File 1 content');
        }).toPass();

        // Verify disk content
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'preserved.adoc'), 'utf8');
        expect(content).toBe('== File 1 content');

        // Cancelled rename also preserves
        const input2 = await triggerRename(page, page.locator('[data-testid="file-item"][data-file-path="preserved.adoc"]'));
        await cancelRename(page, input2, 'broken.adoc');

        await expect(async () => {
            const editorContent = await page.evaluate(() => window.__TEST_editorStore.content);
            expect(editorContent).toBe('== File 1 content');
        }).toPass();
    });

    test('Renaming: Complex whitespace and dot handling', async ({ page }) => {
        // Helper to reset state
        const resetFile = async (currentName: string) => {
            const item = page.locator(`[data-testid="file-item"][data-file-path="${currentName}"]`);
            const input = await triggerRename(page, item);
            await completeRename(page, input, 'file1.adoc');
            await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]'), 'Failed to reset file to file1.adoc').toBeVisible();
        };

        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');

        // 1. Leading dots: .config -> .config
        let input = await triggerRename(page, fileItem);
        await completeRename(page, input, '.config');
        await expect(page.locator('[data-testid="file-item"][data-file-path=".config.adoc"]'), 'Failed to rename .config -> .config.adoc').toBeVisible();
        await resetFile('.config.adoc');

        // 2. Multiple dots: my..file.adoc -> my.file.adoc
        const fileItem2 = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]'); // Re-locate after reset? Should be same but safer.
        input = await triggerRename(page, fileItem2);
        await completeRename(page, input, 'my..file.adoc');
        await expect(page.locator('[data-testid="file-item"][data-file-path="my.file.adoc"]'), 'Failed to rename my..file.adoc -> my.file.adoc').toBeVisible();
        await resetFile('my.file.adoc');

        // 3. Spaces around dots: my . file . adoc -> my.file.adoc
        const fileItem3 = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        input = await triggerRename(page, fileItem3);
        await completeRename(page, input, 'my . file . adoc');
        await expect(page.locator('[data-testid="file-item"][data-file-path="my.file.adoc"]'), 'Failed to rename "my . file . adoc" -> my.file.adoc').toBeVisible();
        await resetFile('my.file.adoc');

        // 4. Empty parts: foo..bar -> foo.bar.adoc
        const fileItem4 = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        input = await triggerRename(page, fileItem4);
        await completeRename(page, input, 'foo..bar');
        await expect(page.locator('[data-testid="file-item"][data-file-path="foo.bar.adoc"]'), 'Failed to rename foo..bar -> foo.bar.adoc').toBeVisible();
        await resetFile('foo.bar.adoc');

        // 5. Only dots: ... -> . (Disallowed -> Cancel)
        const fileItem5 = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        input = await triggerRename(page, fileItem5);

        // We expect it to cancel/reset. completeRename waits for input to not be visible.
        // We can use completeRename here as it fills and presses enter.
        await completeRename(page, input, '...');

        // Rename should have cancelled/failed essentially, meaning original file remains.
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]'), 'Original file name not visible after disallowed rename').toBeVisible();
    });

    test('Validation - Unsafe characters', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        const input = await triggerRename(page, fileItem);

        await input.fill('bad/name.adoc');

        // Schedule dialog handling BEFORE the blocking action (Enter)
        await handleNextDialog(page, 'confirm');
        await page.keyboard.press('Enter');

        // Input should still be visible because validation failed
        await expect(page.locator('[data-testid="rename-input"]')).toBeVisible();
        await expect(page.locator('[data-testid="rename-input"]')).toBeFocused();

        // Verify message
        const message = await getLastDialogMessage(page);
        expect(message).toContain('Invalid character');
    });

    test('Validation - Conflict', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
        const input = await triggerRename(page, fileItem);

        // 1. Decline override
        await input.fill('conflict.adoc');

        await handleNextDialog(page, 'cancel');
        await page.keyboard.press('Enter');

        // Should still be in rename mode (dialog dismissed)
        await expect(page.locator('[data-testid="rename-input"]')).toBeVisible();
        await expect(page.locator('[data-testid="rename-input"]')).toBeFocused();

        expect(await getLastDialogMessage(page)).toContain('already exists');

        // 2. Accept override
        // Retrigger enter
        await handleNextDialog(page, 'confirm');
        await page.keyboard.press('Enter');

        // Should succeed now
        await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).not.toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path="conflict.adoc"]')).toBeVisible();
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'conflict.adoc'), 'utf8');
        expect(content).toBe('== File 1 content');
    });

    test('Rename commits when clicking another file', async ({ page }) => {
        await verifyRenameOnFocusChange(page, fsSetup, 'file1.adoc', 'renamed_via_file_click.adoc', async () => {
            const otherFile = page.locator('[data-testid="file-item"][data-file-path="file2.adoc"]');
            await otherFile.click();
        });

        // Verify content preserved after file click rename
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'renamed_via_file_click.adoc'), 'utf8');
        expect(content).toBe('== File 1 content');
    });

    test('Rename commits when clicking editor', async ({ page }) => {
        // Use file2.adoc
        await verifyRenameOnFocusChange(page, fsSetup, 'file2.adoc', 'renamed_via_editor_click.adoc', async () => {
            const editor = page.locator('.monaco-editor').first();
            await editor.click();
        });
    });

    test('Rename commits when clicking title bar', async ({ page }) => {
        // Use conflict.adoc (available from setup) or create a temp file if needed.
        // The setup creates: file1.adoc, file2.adoc, conflict.adoc
        // Let's use conflict.adoc
        await verifyRenameOnFocusChange(page, fsSetup, 'conflict.adoc', 'renamed_via_title_click.adoc', async () => {
            await page.locator('header').click();
        });
    });

    test('Rename stays active on invalid name when clicking another file', async ({ page }) => {
        const originalName = 'file1.adoc';
        const newName = 'invalid/name.adoc';

        const fileItem = page.locator(`[data-testid="file-item"][data-file-path="${originalName}"]`);
        await fileItem.click();
        const input = await triggerRename(page, fileItem);
        await input.fill(newName);

        // Trigger the focus change (click other file)
        const otherFile = page.locator('[data-testid="file-item"][data-file-path="file2.adoc"]');

        await handleNextDialog(page, 'confirm');
        await otherFile.click();

        // Expect Alert
        expect(await getLastDialogMessage(page)).toContain('Invalid character');

        // Now input should STILL be visible and focused
        await expect(input).toBeVisible();
        await expect(input).toBeFocused();

        // Verify old name is NOT visible yet (because input is still there)
        // actually, old name is hidden while renaming input is shown usually, or input sits on top.
        // The implementation usually hides the name label when input is active.
        // Let's check that we are still in rename mode.
        // If necessary we can check input value is preserved.
        await expect(input).toHaveValue(newName);
    });
});

// Helper Functions
import { Page, Locator } from '@playwright/test';


// Helper to verify rename behavior on focus change
async function verifyRenameOnFocusChange(
    page: Page,
    fsSetup: FsTestSetup, // passed in to access tempDir1
    originalName: string,
    newName: string,
    triggerFocusChange: () => Promise<void>
) {
    const fileItem = page.locator(`[data-testid="file-item"][data-file-path="${originalName}"]`);
    await fileItem.click();
    await expect(fileItem).toHaveClass(/selected/);

    const input = await triggerRename(page, fileItem);
    await input.fill(newName);

    // Trigger the focus change
    await triggerFocusChange();

    // Verify input is gone
    await expect(input).not.toBeVisible();

    // Verify new name exists
    await expect(page.locator(`[data-testid="file-item"][data-file-path="${newName}"]`)).toBeVisible();
    expect(fs.existsSync(path.join(fsSetup.tempDir1, newName))).toBe(true);
    // Verify old name gone
    await expect(page.locator(`[data-testid="file-item"][data-file-path="${originalName}"]`)).not.toBeVisible();
    expect(fs.existsSync(path.join(fsSetup.tempDir1, originalName))).toBe(false);

}

async function triggerRename(page: Page, fileItem: Locator, method: 'f2' | 'button' = 'f2'): Promise<Locator> {
    await fileItem.click();
    await expect(fileItem).toHaveClass(/selected/);

    if (method === 'button') {
        await fileItem.hover();
        const renameBtn = fileItem.locator('[data-testid="rename-button"]');
        await expect(renameBtn).toBeVisible();
        await renameBtn.click();
    } else {
        await page.keyboard.press('F2');
    }

    const input = page.locator('[data-testid="rename-input"]');
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    return input;
}

async function completeRename(page: Page, input: Locator, newName: string, method: 'enter' | 'button' = 'enter') {
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

async function cancelRename(page: Page, input: Locator, inputContent?: string) {
    if (inputContent !== undefined) {
        await input.fill(inputContent);
    }
    await page.keyboard.press('Escape');
    await expect(input).not.toBeVisible();
}
