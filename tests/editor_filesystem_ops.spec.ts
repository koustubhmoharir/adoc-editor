import { helpers, test, expect } from './fixtures.ts';

// Helpers
import { getFileItem, getRenameInput } from './helpers/locators.ts';
import { triggerRename, completeRename, cancelRename, verifyRenameOnFocusChange, loadInitialDirectory } from './helpers/sidebar_helpers.ts';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
    fsSetup.createFile('dir1', 'file1.adoc', '== File 1 content');
    fsSetup.createFile('dir1', 'file2.adoc', '== File 2 content');
    fsSetup.createFile('dir1', 'conflict.adoc', '== Conflict File');
});

test('Enter and exit renaming via keyboard (F2, Enter)', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    // Select file using robust selector
    const fileItem = getFileItem(page, 'file1.adoc');

    // Use helper to trigger rename via F2
    const input = await triggerRename(page, fileItem);

    // Rename and complete via Enter
    await completeRename(page, input, 'renamed.adoc', 'enter');

    await expect(getFileItem(page, 'renamed.adoc')).toBeVisible();
    expect(fsSetup.exists('dir1', 'renamed.adoc')).toBe(true);
});

test('Cancel renaming via Esc', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = getFileItem(page, 'file1.adoc');
    const input = await triggerRename(page, fileItem);

    await cancelRename(page, input, 'aborted_change.adoc');

    // Input gone, old name remains
    await expect(getFileItem(page, 'file1.adoc')).toBeVisible();
    expect(fsSetup.exists('dir1', 'file1.adoc')).toBe(true);
    expect(fsSetup.exists('dir1', 'aborted_change.adoc')).toBe(false);
});

test('Cancel renaming via cancel button', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = getFileItem(page, 'file1.adoc');
    const input = await triggerRename(page, fileItem);

    await input.fill('aborted_change.adoc');

    const cancelBtn = page.locator('[data-testid="cancel-rename-button"]');
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(input).not.toBeVisible();

    // Input gone, old name remains
    await expect(getFileItem(page, 'file1.adoc')).toBeVisible();
    expect(fsSetup.exists('dir1', 'file1.adoc')).toBe(true);
    expect(fsSetup.exists('dir1', 'aborted_change.adoc')).toBe(false);
});

test('Cancel renaming resets to original name if empty or same', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = getFileItem(page, 'file1.adoc');

    // 1. Same name (Use helper, defaults to F2 trigger, Enter completion)
    let input = await triggerRename(page, fileItem);
    await input.press('Enter');
    await expect(input).not.toBeVisible();
    await expect(getFileItem(page, 'file1.adoc')).toBeVisible();

    // 2. Empty name
    input = await triggerRename(page, fileItem);
    await completeRename(page, input, '');
    await expect(getFileItem(page, 'file1.adoc')).toBeVisible();
});

test('Entering rename mode selects filename without extension', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = getFileItem(page, 'file1.adoc');
    await triggerRename(page, fileItem);

    // Type 'changed' immediately to verify selection handling
    await page.keyboard.type('changed');
    await page.keyboard.press('Enter');

    // Check result
    await expect(getFileItem(page, 'changed.adoc')).toBeVisible();
    expect(fsSetup.exists('dir1', 'changed.adoc')).toBe(true);
});

test('Renaming preserves file content and editor content', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = getFileItem(page, 'file1.adoc');
    await fileItem.click(); // Ensure selection for content load check first

    // Ensure content loaded
    await expect(async () => {
        const editorContent = await helpers.getEditorContent(page);
        expect(editorContent).toBe('== File 1 content');
    }).toPass();

    // Rename
    const input = await triggerRename(page, fileItem);
    await completeRename(page, input, 'preserved.adoc');

    // Verify editor content
    await expect(async () => {
        const editorContent = await helpers.getEditorContent(page);
        expect(editorContent).toBe('== File 1 content');
    }).toPass();

    // Verify disk content
    const content = fsSetup.readFile('dir1', 'preserved.adoc');
    expect(content).toBe('== File 1 content');

    // Cancelled rename also preserves
    const input2 = await triggerRename(page, getFileItem(page, 'preserved.adoc'));
    await cancelRename(page, input2, 'broken.adoc');

    await expect(async () => {
        const editorContent = await helpers.getEditorContent(page);
        expect(editorContent).toBe('== File 1 content');
    }).toPass();
});

test('Renaming: Complex whitespace and dot handling', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    // Helper to reset state
    const resetFile = async (currentName: string) => {
        const item = getFileItem(page, currentName);
        const input = await triggerRename(page, item);
        await completeRename(page, input, 'file1.adoc');
        await expect(getFileItem(page, 'file1.adoc'), 'Failed to reset file to file1.adoc').toBeVisible();
    };

    const fileItem = getFileItem(page, 'file1.adoc');

    // 1. Leading dots: .config -> .config
    let input = await triggerRename(page, fileItem);
    await completeRename(page, input, '.config');
    await expect(getFileItem(page, '.config'), 'Failed to rename file1.adoc -> .config').toBeVisible();
    await resetFile('.config');

    // 2. Multiple dots: my..file.adoc -> my.file.adoc
    const fileItem2 = getFileItem(page, 'file1.adoc'); // Re-locate after reset? Should be same but safer.
    input = await triggerRename(page, fileItem2);
    await completeRename(page, input, 'my..file.adoc');
    await expect(getFileItem(page, 'my.file.adoc'), 'Failed to rename my..file.adoc -> my.file.adoc').toBeVisible();
    await resetFile('my.file.adoc');

    // 3. Spaces around dots: my . file . adoc -> my.file.adoc
    const fileItem3 = getFileItem(page, 'file1.adoc');
    input = await triggerRename(page, fileItem3);
    await completeRename(page, input, 'my . file . adoc');
    await expect(getFileItem(page, 'my.file.adoc'), 'Failed to rename "my . file . adoc" -> my.file.adoc').toBeVisible();
    await resetFile('my.file.adoc');

    // 4. Empty parts: foo..bar -> foo.bar.adoc
    const fileItem4 = getFileItem(page, 'file1.adoc');
    input = await triggerRename(page, fileItem4);
    await completeRename(page, input, 'foo..bar');
    await expect(getFileItem(page, 'foo.bar'), 'Failed to rename foo..bar -> foo.bar').toBeVisible();
    await resetFile('foo.bar');

    // 5. Only dots: ... -> . (Disallowed -> Cancel)
    const fileItem5 = getFileItem(page, 'file1.adoc');
    input = await triggerRename(page, fileItem5);

    // We expect it to cancel/reset. completeRename waits for input to not be visible.
    // We can use completeRename here as it fills and presses enter.
    await completeRename(page, input, '...');

    // Rename should have cancelled/failed essentially, meaning original file remains.
    await expect(getFileItem(page, 'file1.adoc'), 'Original file name not visible after disallowed rename').toBeVisible();
});

test('Validation - Unsafe characters', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = getFileItem(page, 'file1.adoc');
    const input = await triggerRename(page, fileItem);

    await input.fill('bad/name.adoc');

    // Schedule dialog handling BEFORE the blocking action (Enter)
    const dialogHandle = await helpers.handleNextDialog(page, 'confirm');
    await page.keyboard.press('Enter');

    // Input should still be visible because validation failed
    await expect(getRenameInput(page)).toBeVisible();
    await expect(getRenameInput(page)).toBeFocused();

    // Verify message synchronously
    expect(await dialogHandle.getMessage()).toContain('Invalid character');

    await page.keyboard.press('Escape');
    await expect(input).not.toBeVisible();
});

test('Validation - Conflict', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const fileItem = getFileItem(page, 'file1.adoc');
    const input = await triggerRename(page, fileItem);

    // 1. Decline override
    await input.fill('conflict.adoc');

    let dialogHandle = await helpers.handleNextDialog(page, 'confirm');
    await page.keyboard.press('Enter');

    // Should still be in rename mode (dialog dismissed)
    await expect(getRenameInput(page)).toBeVisible();
    await expect(getRenameInput(page)).toBeFocused();

    expect(await dialogHandle.getMessage()).toContain('already exists');

    await page.keyboard.press('Escape');
    await expect(input).not.toBeVisible();
});

test('Rename commits when clicking another file', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    await verifyRenameOnFocusChange(page, fsSetup, 'file1.adoc', 'renamed_via_file_click.adoc', async () => {
        const otherFile = getFileItem(page, 'file2.adoc');
        await otherFile.click();
    });

    // Verify content preserved after file click rename
    const content = fsSetup.readFile('dir1', 'renamed_via_file_click.adoc');
    expect(content).toBe('== File 1 content');
});

test('Rename commits when clicking editor', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    // Use file2.adoc
    await verifyRenameOnFocusChange(page, fsSetup, 'file2.adoc', 'renamed_via_editor_click.adoc', async () => {
        const editor = page.locator('.monaco-editor').first();
        await editor.click();
    });
});

test('Rename commits when clicking title bar', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');
    // Use conflict.adoc (available from setup) or create a temp file if needed.
    // The setup creates: file1.adoc, file2.adoc, conflict.adoc
    // Let's use conflict.adoc
    await verifyRenameOnFocusChange(page, fsSetup, 'conflict.adoc', 'renamed_via_title_click.adoc', async () => {
        await page.locator('header').click();
    });
});

test('Rename stays active on invalid name when clicking another file', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const originalName = 'file1.adoc';
    const newName = 'invalid/name.adoc';

    const fileItem = getFileItem(page, originalName);
    await fileItem.click();
    const input = await triggerRename(page, fileItem);
    await input.fill(newName);

    // Trigger the focus change (click other file)
    const otherFile = getFileItem(page, 'file2.adoc');

    const dialogHandle = await helpers.handleNextDialog(page, 'confirm');
    await otherFile.click();

    // Now input should STILL be visible and focused
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    // Expect Alert
    expect(await dialogHandle.getMessage()).toContain('Invalid character');

    // Verify old name is NOT visible yet (because input is still there)
    // actually, old name is hidden while renaming input is shown usually, or input sits on top.
    // The implementation usually hides the name label when input is active.
    // Let's check that we are still in rename mode.
    // If necessary we can check input value is preserved.
    await expect(input).toHaveValue(newName);
});
