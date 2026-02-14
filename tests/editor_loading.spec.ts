import { helpers, test, expect } from './fixtures.ts';
import * as path from 'path';

// Helpers
import { openContextMenu, loadInitialDirectory, expectMonacoEditorToBeFocused } from './helpers/sidebar_helpers.ts';
import { getFileItem } from './helpers/locators.ts';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
    // Populate setup
    fsSetup.createFile('dir1', 'file1.adoc', '== File 1\nContent of file 1.');
    fsSetup.createFile('dir1', 'file2.adoc', '== File 2\nContent of file 2.');
    fsSetup.createFile('dir1', 'subdir/nested.adoc', '== Nested\nContent of nested file.');
    fsSetup.createFile('dir1', 'other.txt', 'Text file');
    fsSetup.createFile('dir2', 'dir2_file.adoc', '== Dir2 File\nContent of dir2 file.');
});

test('Opening a directory shows all adoc files within it recursively', async ({ page }) => {
    // Trigger open directory
    await loadInitialDirectory(page, 'dir1');

    // Check for file items in sidebar using text
    // We look for the file names which should be rendered in the tree
    await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-item"][data-file-path="file2.adoc"]')).toBeVisible();
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="subdir"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-item"][data-file-path="subdir/nested.adoc"]')).toBeVisible();
    await expect(page.locator('[data-testid="file-item"][data-file-path="other.txt"]')).toBeVisible();

    // Verify no dirty indicator initially
    await expect(page.getByTestId('dirty-indicator')).not.toBeVisible();
});

test('Clicking on a file opens the file in the editor', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    // Click file1.adoc
    await page.click('[data-testid="file-item"][data-file-path="file1.adoc"]');

    // Check editor content
    // We wait for content to be set
    await expect(async () => {
        const editorContent = await helpers.getEditorContent(page);
        expect(editorContent).toBe('== File 1\nContent of file 1.');
    }).toPass();

    // Check title bar name
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc');

    // Check dirty indicator is NOT visible
    await expect(page.getByTestId('dirty-indicator')).not.toBeVisible();
});

test('If there are no unsaved changes, opening a new directory does not change content on disk', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');
    await page.click('[data-testid="file-item"][data-file-path="file1.adoc"]');

    // Ensure loaded
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc');

    // Switch to dir2
    await helpers.setDirectoryPickerChoice(page, 'dir2');

    // Open directory again (click current directory name in sidebar)
    await page.click('[data-testid="open-directory-button"]');

    // Check if dir2 loaded
    await expect(page.locator('[data-testid="file-item"][data-file-path="dir2_file.adoc"]')).toBeVisible();

    // Select file in dir2
    await page.click('[data-testid="file-item"][data-file-path="dir2_file.adoc"]');
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('dir2_file.adoc');

    // Check disk content of file1 in dir1 was not changed
    const content = fsSetup.readFile('dir1', 'file1.adoc');
    expect(content).toBe('== File 1\nContent of file 1.');
});

test('If there are no unsaved changes, opening a different file does not change content on disk', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');
    await page.click('[data-testid="file-item"][data-file-path="file1.adoc"]');

    // Switch to file 2
    await page.click('[data-testid="file-item"][data-file-path="file2.adoc"]');
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file2.adoc');

    // Check file1 content intact
    const content = fsSetup.readFile('dir1', 'file1.adoc');
    expect(content).toBe('== File 1\nContent of file 1.');
});

test('If any changes are made to the current file, they are auto-saved after a short delay @OwnContext', async ({ browser, fsSetup }) => {
    // This test is special because it installs a clock and cannot run on the shared page without messing with other tests
    // Hence we create a new context here and must close it regardless of test status.
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        await page.clock.install();

        await helpers.setupNewPage(page, { fsSetup });
        await loadInitialDirectory(page, 'dir1');

        await page.click('[data-testid="file-item"][data-file-path="file1.adoc"]');

        // Wait for file to load
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc');

        // Edit content
        // IMPORTANT: Cannot call setEditorContent when clocks are mocked
        await helpers.setEditorContentDirect(page, 'Updated content.');

        // Dirty indicator visible
        await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();
        // Fast forward time (5s)
        await page.clock.fastForward(5500);

        // Check disk content
        const content = fsSetup.readFile('dir1', 'file1.adoc');
        expect(content).toBe('Updated content.');

        // Check dirty indicator gone
        await expect(page.locator('[data-testid="dirty-indicator"]')).not.toBeVisible();
    }
    finally {
        await context.close();
    }
});

test('If changes are made and a new file is opened, changes are saved before new file is opened', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');
    await page.click('[data-testid="file-item"][data-file-path="file1.adoc"]');

    // Disable auto-save
    await helpers.disableAutoSave(page);

    // Edit
    await helpers.replaceEditorContentByTyping(page, 'Modified content before switch.');

    // Wait for dirty state
    await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();

    // Switch to file 2 immediately
    await page.click('[data-testid="file-item"][data-file-path="file2.adoc"]');

    // Verify file 2 loaded
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file2.adoc');

    // Verify file 1 saved
    const content = fsSetup.readFile('dir1', 'file1.adoc');
    expect(content).toBe('Modified content before switch.');
});

test('If changes are made and page is refreshed, changes are saved', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');
    await page.click('[data-testid="file-item"][data-file-path="file1.adoc"]');

    // Disable auto-save
    await helpers.disableAutoSave(page);

    // Edit
    await helpers.replaceEditorContentByTyping(page, 'Modified content before refresh.');

    // Wait for dirty state
    await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();

    // Reload
    await helpers.reloadPage(page);

    // Verify file 1 saved
    const content = fsSetup.readFile('dir1', 'file1.adoc');
    expect(content).toBe('Modified content before refresh.');
});

test('Refreshing the page retains the selection and infers language', async ({ page, fsSetup }) => {
    // Create a JS file to check language inference (default is asciidoc)
    fsSetup.createFile('dir1', 'script.js', 'console.log("hello");');

    await loadInitialDirectory(page, 'dir1');
    await page.click('[data-testid="file-item"][data-file-path="script.js"]');
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('script.js');

    // Reload without skip_restore to test retention
    await helpers.reloadPage(page, { skipRestore: false });
    await helpers.setDirectoryPickerChoice(page, 'dir1');

    // Wait for restoration
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('script.js'); // Filename should appear

    // Content should match
    await expect(async () => {
        const editorContent = await helpers.getEditorContent(page);
        // Should be original content if no edits
        expect(editorContent).toBe('console.log("hello");');
    }).toPass();

    // Verify language is javascript
    const languageId = await page.evaluate(() => {
        return (window as any).__TEST_editorStore.editor.getModel().getLanguageId();
    });
    expect(languageId).toBe('javascript');
});

test('Nested directory states are persisted correctly', async ({ page, fsSetup }) => {
    // Setup deep structure in dir1
    fsSetup.createFile('dir1', path.join('level1', 'level2', 'level3', 'deep_file.adoc'), '== Deep File');

    // Refresh file explorer by opening folder again (or just start here)
    await loadInitialDirectory(page, 'dir1');

    // Verify initial state: All expanded by default
    // level1 visible in Sidebar
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="level1"]')).toBeVisible();
    // level2 visible
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="level1/level2"]')).toBeVisible();
    // level3 visible
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="level1/level2/level3"]')).toBeVisible();
    // deep_file visible
    await expect(page.locator('[data-testid="file-item"][data-file-path="level1/level2/level3/deep_file.adoc"]')).toBeVisible();

    // Collapse level3. (State: level1=Open, level2=Open, level3=Collapsed)
    await page.click('[data-testid="directory-item"][data-dir-path="level1/level2/level3"] [data-testid="toggle-directory-btn"]');
    // deep_file should hide
    await expect(page.locator('[data-testid="file-item"][data-file-path="level1/level2/level3/deep_file.adoc"]')).not.toBeVisible();

    // Collapse level1. (State: level1=Collapsed, level2=? (hidden), level3=Collapsed)
    await page.click('[data-testid="directory-item"][data-dir-path="level1"] [data-testid="toggle-directory-btn"]');
    // level2 should hide
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="level1/level2"]')).not.toBeVisible();

    // Simulate reload without skip_restore
    await helpers.reloadPage(page, { skipRestore: false });
    await helpers.setDirectoryPickerChoice(page, 'dir1');

    // Wait for restoration
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="level1"]')).toBeVisible();

    // Verify level1 is collapsed immediately after load
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="level1/level2"]')).not.toBeVisible();

    // Expand level1
    await page.click('[data-testid="directory-item"][data-dir-path="level1"] [data-testid="toggle-directory-btn"]');

    // Verify level2 is visible and expanded (children visible)
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="level1/level2"]')).toBeVisible();
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="level1/level2/level3"]')).toBeVisible();

    // Verify level3 is visible but collapsed (children NOT visible)
    // deep_file should still be hidden
    await expect(page.locator('[data-testid="file-item"][data-file-path="level1/level2/level3/deep_file.adoc"]')).not.toBeVisible();
});

// New File Feature Tests

test('Creating a new file from Title Bar', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');
    // Wait for file tree to load
    await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).toBeVisible();

    const title = await page.locator('[data-testid="new-file-button-titlebar"]').getAttribute('title');
    expect(title).toBe('New File in dir1');

    // Initially in root, no file selected.
    // Click New File button in Title Bar.
    await page.click('[data-testid="new-file-button-titlebar"]');

    // Expect rename input
    const renameInput = page.locator('[data-testid="rename-input"]');
    await expect(renameInput).toBeVisible();

    // Verify unique name prefill
    await expect(renameInput).toHaveValue('new-1.adoc');

    // Verify file DOES NOT EXIST yet
    expect(fsSetup.exists('dir1', 'new-1.adoc')).toBe(false);

    // Commit creation
    await page.keyboard.press('Enter');
    await expect(renameInput).not.toBeVisible();

    // Should create new-1.adoc
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-1.adoc');

    // Check file exists on disk
    const newFileContent = fsSetup.readFile('dir1', 'new-1.adoc');
    expect(newFileContent).toBe('');

    // Check sidebar has new file selected
    await expect(page.locator('[data-testid="file-item"][data-file-path="new-1.adoc"]')).toBeVisible();

    // Verify NEW file is valid and clean (not dirty)
    await expect(page.getByTestId('dirty-indicator')).not.toBeVisible();
});

test('Cancelling new file creation creates nothing', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    await page.click('[data-testid="new-file-button-titlebar"]');

    const renameInput = page.locator('[data-testid="rename-input"]');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('new-1.adoc');

    // Cancel
    await page.keyboard.press('Escape');
    await expect(renameInput).not.toBeVisible();

    // Verify no file created
    expect(fsSetup.exists('dir1', 'new-1.adoc')).toBe(false);
    // Verify ghost node removed (no file item with that path/name)
    await expect(page.locator('[data-testid="file-item"][data-file-path="new-1.adoc"]')).not.toBeVisible();
});

test('Creating multiple new files increments counter', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');
    await expect(page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]')).toBeVisible();

    await page.click('[data-testid="new-file-button-titlebar"]');
    let renameInput = page.locator('[data-testid="rename-input"]');
    await expect(renameInput).toBeVisible();
    await expect(renameInput).toHaveValue('new-1.adoc');

    // Commit new-1
    await page.keyboard.press('Enter');
    await expect(renameInput).not.toBeVisible();
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-1.adoc');

    // Create second file
    await page.click('[data-testid="new-file-button-titlebar"]');
    renameInput = page.locator('[data-testid="rename-input"]');
    await expect(renameInput).toBeVisible();
    // Should be new-2 now
    await expect(renameInput).toHaveValue('new-2.adoc');

    // Commit new-2
    await page.keyboard.press('Enter');
    await expect(renameInput).not.toBeVisible();
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-2.adoc');

    expect(fsSetup.readFile('dir1', 'new-1.adoc')).toBe('');
    expect(fsSetup.readFile('dir1', 'new-2.adoc')).toBe('');
});

test('Creating new file auto-saves current dirty file', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');
    await page.click('[data-testid="file-item"][data-file-path="file1.adoc"]');
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc');

    // Disable auto-save
    await helpers.disableAutoSave(page);

    // Edit
    await helpers.replaceEditorContentByTyping(page, 'Modified content.');
    await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();

    // Create new file
    await page.click('[data-testid="new-file-button-titlebar"]');
    await expect(page.locator('[data-testid="rename-input"]')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="rename-input"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-1.adoc');

    // Check existing file content
    const content = fsSetup.readFile('dir1', 'file1.adoc');
    expect(content).toBe('Modified content.');

    // New file should be clean
    await expect(page.getByTestId('dirty-indicator')).not.toBeVisible();
});

test('Creating new file in subdirectory via Sidebar', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'dir1');

    // Expand subdirectory if needed (it is empty so might show as empty)
    // wait for sidebar items
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="subdir"]')).toBeVisible();

    // We select based on 'subdir' text, finding the parent container
    const subdirItem = page.locator('[data-testid="directory-item"][data-dir-path="subdir"]');



    // Right click to open context menu
    await openContextMenu(page, subdirItem);

    const newFileBtn = page.locator('[data-testid="ctx-new-file"]');
    await expect(newFileBtn).toBeVisible();

    // Click New File in context menu
    await newFileBtn.click();
    await expect(page.locator('[data-testid="rename-input"]')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="rename-input"]')).not.toBeVisible();

    // Should create new-1.adoc INSIDE subdir

    // Allow operation to complete
    expect(fsSetup.readFile('dir1', 'subdir/new-1.adoc')).toBe('');

    await expectMonacoEditorToBeFocused(page);
    await expect(getFileItem(page, 'subdir/new-1.adoc')).toHaveAttribute('data-selected');

    // Check it is selected in title bar
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-1.adoc');


    // Verify TitleBar tooltip updates to subdirectory
    // Since we refactored title bar to use data-testid, querying by title is fine for check, or use data-testid
    // The title updates dynamically, so checking attribute on data-testid element is better
    await expect(page.locator('[data-testid="new-file-button-titlebar"]')).toHaveAttribute('title', 'New File in dir1/subdir');
});

test('Title bar filename tooltip shows relative path and clicking focuses sidebar', async ({ page, fsSetup }) => {
    // Setup nested structure
    // structure: root/dirA/fileA.adoc
    // structure: root/dirA/subdirB/fileB.adoc
    fsSetup.createFile('dirA', 'fileA.adoc', 'File A');
    fsSetup.createFile('dirA', 'subdirB/fileB.adoc', 'File B');

    await loadInitialDirectory(page, 'dirA');

    // 1. Open deeply nested file
    // Check expandability
    await expect(page.locator('[data-testid="directory-item"][data-dir-path="subdirB"]')).toBeVisible();

    const fileBItem = page.locator('[data-testid="file-item"][data-file-path="subdirB/fileB.adoc"]');
    await expect(fileBItem).toBeVisible();
    await fileBItem.click();

    // Verify Title Bar
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('fileB.adoc');
    // Verify Tooltip
    // root is dirA. path relative to root is subdirB/fileB.adoc
    await expect(page.locator('[data-testid="current-filename"]')).toHaveAttribute('title', 'subdirB/fileB.adoc');

    // 2. Test Click to Focus

    // Focus the editor to blur the sidebar item
    await helpers.getEditorContent(page); // wait for content
    await page.locator('.monaco-editor').first().click();

    // Verify tree item is NOT focused
    await expect(fileBItem).not.toBeFocused();

    // Click Title Bar Filename
    await page.locator('[data-testid="current-filename"]').click();

    // Verify sidebar item IS focused
    await expect(fileBItem).toBeFocused();
});
