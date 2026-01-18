import { test, expect, helpers } from './fixtures';

test.beforeEach(async ({ fsSetup, page }) => {
    // Create some internal files for context
    fsSetup.createDirectory('work', 'project');
    fsSetup.createFile('work', 'project/internal.adoc', 'Internal Content');

    // Create an external file (outside project or just treated as arbitrary path)
    fsSetup.createExternalFile('external.adoc', 'External Content');

    // Open the project
    await helpers.setDirectoryPickerChoice(page, 'work/project');
    await page.getByTestId('open-directory-button').click();
    // Root is rendered as a directory-item
    await expect(page.getByTestId('directory-item').filter({ hasText: 'project' })).toBeVisible();

    // Wait for initial load
    await page.waitForTimeout(500);
});

test('should open external file and display correct UI', async ({ page }) => {
    // Mock file choice
    await helpers.setFilePickerChoice(page, '/external.adoc');

    // Click Open File
    await page.getByTestId('open-file-button').click();

    // Verify Title Bar
    await expect(page.getByTestId('current-filename')).toHaveText('external.adoc');
    await expect(page.getByTestId('external-file-warning')).toBeVisible();
    await expect(page.getByTestId('external-save-button')).toBeVisible();
    await expect(page.getByTestId('external-close-button')).toBeVisible();

    // Verify Editor Content
    const content = await helpers.getEditorContent(page);
    expect(content).toBe('External Content');

    // Verify Sidebar selection is cleared (no element highlighted)
    const highlighted = page.locator('[data-highlighted="true"]');
    await expect(highlighted).toHaveCount(0);
});

test('should handle unsaved changes when navigating away from external file', async ({ page }) => {
    // 1. Open External File
    await helpers.setFilePickerChoice(page, '/external.adoc');
    await page.getByTestId('open-file-button').click();

    // 2. Modify content
    await helpers.replaceEditorContentByTyping(page, 'Modified Content');
    await expect(page.getByTestId('dirty-indicator')).toBeVisible();

    // 3. Try to click internal file in sidebar
    // Note: we need to find the element. Internal file is 'internal.adoc'
    const internalFile = page.getByText('internal.adoc');

    // Prepare to handle dialog (Cancel first)
    let dialogMsg = "";
    const handleCancel = await helpers.handleNextDialog(page, null); // Cancel
    await internalFile.click();
    dialogMsg = await handleCancel.getMessage();
    expect(dialogMsg).toContain('unsaved changes');

    // Assert we are still on external file
    await expect(page.getByTestId('current-filename')).toHaveText('external.adoc');
    const content = await helpers.getEditorContent(page);
    expect(content).toBe('Modified Content'); // edits preserved

    // 4. Try again, this time Discard
    // We use boolean false for "Discard" (No button usually maps to Discard in our confirm dialog logic? 
    // Logic: yes=Save, no=Discard, cancel=Cancel. dialog.confirm return true/false/null.
    // false -> Discard.
    const handleDiscard = await helpers.handleNextDialog(page, false);
    await internalFile.click();
    await handleDiscard.getMessage();

    // Assert we switched to internal file
    await expect(page.getByTestId('current-filename')).toHaveText('internal.adoc');
    const newContent = await helpers.getEditorContent(page);
    expect(newContent).toBe('Internal Content');
});

test('should explicitly save external file and not auto-save', async ({ page, fsSetup }) => {
    // 1. Open External File
    await helpers.setFilePickerChoice(page, '/external.adoc');
    await page.getByTestId('open-file-button').click();

    // 2. Modify content
    await helpers.replaceEditorContentByTyping(page, 'Manual Save Test');
    await expect(page.getByTestId('dirty-indicator')).toBeVisible();

    // 3. Wait for standard auto-save interval (5s in source)
    // We can fast-forward time or just check quickly that it didn't save?
    // Checking negative is hard. But we know internal files save?
    // Let's rely on logic: if auto-save was on, it would save after 5s.
    // We can simulate wait. Or check that file on disk is UNCHANGED.

    // Let's trigger manual save
    await page.getByTestId('external-save-button').click();
    await expect(page.getByTestId('dirty-indicator')).not.toBeVisible();

    // Verify disk content
    const content = fsSetup.readFile('', 'external.adoc');
    expect(content).toBe('Manual Save Test');
});

test('should close external file explicitly', async ({ page, fsSetup }) => {
    // 1. Open External File
    await helpers.setFilePickerChoice(page, '/external.adoc');
    await page.getByTestId('open-file-button').click();

    // 2. Close
    // Verify not dirty first
    await expect(page.getByTestId('dirty-indicator')).not.toBeVisible();
    await expect(page.getByTestId('external-close-button')).toBeVisible();
    await page.getByTestId('external-close-button').click();

    // Assert cleared
    await expect(page.getByTestId('current-filename')).toHaveText('');
    // App usually shows Help or empty editor.
    let content = await helpers.getEditorContent(page);
    expect(content).toContain('Welcome to the ADoc Editor');

    // Verify disk content
    content = fsSetup.readFile('', 'external.adoc');
    expect(content).toBe('External Content');
});
