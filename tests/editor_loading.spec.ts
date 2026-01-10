import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FsTestSetup } from './helpers/fs_test_setup';
import { enableTestLogging } from './helpers/test_logging';
import { enableTestGlobals, waitForTestGlobals } from './helpers/test_globals';

// Helpers
import { setEditorContent, getEditorContent, disableAutoSave } from './helpers/editor_helpers';
import { waitForMonaco } from './helpers/monaco_helpers';
import { setMockPickerConfig } from './helpers/mock_helpers';

test.describe('Editor Functionality', () => {
    let fsSetup: FsTestSetup;

    test.beforeEach(async ({ page }) => {
        enableTestLogging(page);
        fsSetup = new FsTestSetup();

        // Populate setup
        fsSetup.createFile('dir1', 'file1.adoc', '== File 1\nContent of file 1.');
        fsSetup.createFile('dir1', 'file2.adoc', '== File 2\nContent of file 2.');
        fsSetup.createFile('dir1', 'subdir/nested.adoc', '== Nested\nContent of nested file.');
        fsSetup.createFile('dir1', 'other.txt', 'Text file');
        fsSetup.createFile('dir2', 'dir2_file.adoc', '== Dir2 File\nContent of dir2 file.');

        await fsSetup.init(page);
        await enableTestGlobals(page);

        await page.goto('/?skip_restore=true');

        // Wait for Monaco to be ready just in case
        await waitForTestGlobals(page);
        await waitForMonaco(page);
    });

    test.afterEach(() => {
        fsSetup.cleanup();
    });

    test('Opening a directory shows all adoc files within it recursively', async ({ page }) => {
        // Trigger open directory
        await page.click('[data-testid="open-folder-button"]');

        // Check for file items in sidebar using text
        // We look for the file names which should be rendered in the tree
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'file1.adoc' })).toBeVisible();
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'file2.adoc' })).toBeVisible();
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'subdir' })).toBeVisible();
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'nested.adoc' })).toBeVisible();
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'other.txt' })).toBeVisible();
    });

    test('Clicking on a file opens the file in the editor', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');

        // Click file1.adoc
        await page.click('[data-testid="file-item"]:has-text("file1.adoc")');

        // Check editor content
        // We wait for content to be set
        await expect(async () => {
            const editorContent = await getEditorContent(page);
            expect(editorContent).toBe('== File 1\nContent of file 1.');
        }).toPass();

        // Check title bar name
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc');
    });

    test('If there are no unsaved changes, opening a new directory does not change content on disk', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');
        await page.click('[data-testid="file-item"]:has-text("file1.adoc")');

        // Ensure loaded
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc');

        // Switch to dir2
        await setMockPickerConfig(page, { name: 'dir2', path: 'dir2' });

        // Open directory again (click current directory name in sidebar)
        await page.click('[data-testid="sidebar-header"]');

        // Check if dir2 loaded
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'dir2_file.adoc' })).toBeVisible();

        // Select file in dir2
        await page.click('[data-testid="file-item"]:has-text("dir2_file.adoc")');
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('dir2_file.adoc');

        // Check disk content of file1 in dir1 was not changed
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('== File 1\nContent of file 1.');
    });

    test('If there are no unsaved changes, opening a different file does not change content on disk', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');
        await page.click('[data-testid="file-item"]:has-text("file1.adoc")');

        // Switch to file 2
        await page.click('[data-testid="file-item"]:has-text("file2.adoc")');
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file2.adoc');

        // Check file1 content intact
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('== File 1\nContent of file 1.');
    });

    test('If any changes are made to the current file, they are auto-saved after a short delay', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');
        await page.click('[data-testid="file-item"]:has-text("file1.adoc")');

        // Wait for file to load
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc');

        // Edit content
        await setEditorContent(page, 'Updated content.');

        // Dirty indicator visible
        await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();

        // Wait for auto-save (5s + buffer)
        // We can override the interval to speed up test?
        // Let's rely on standard wait for now, user did not demand speed but correctness.
        await page.waitForTimeout(5500);

        // Check disk content
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('Updated content.');

        // Check dirty indicator gone
        await expect(page.locator('[data-testid="dirty-indicator"]')).not.toBeVisible();
    });

    test('If changes are made and a new file is opened, changes are saved before new file is opened', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');
        await page.click('[data-testid="file-item"]:has-text("file1.adoc")');

        // Disable auto-save
        await page.evaluate(() => window.__TEST_DISABLE_AUTO_SAVE__ = true);

        // Edit
        await setEditorContent(page, 'Modified content before switch.');

        // Wait for dirty state
        await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();

        // Switch to file 2 immediately
        await page.click('[data-testid="file-item"]:has-text("file2.adoc")');

        // Verify file 2 loaded
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file2.adoc');

        // Verify file 1 saved
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('Modified content before switch.');
    });

    test('If changes are made and page is refreshed, changes are saved', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');
        await page.click('[data-testid="file-item"]:has-text("file1.adoc")');

        // Disable auto-save
        await disableAutoSave(page);

        // Edit
        await setEditorContent(page, 'Modified content before refresh.');

        // Wait for dirty state
        await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();

        // Reload
        await page.reload();

        // Verify file 1 saved
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('Modified content before refresh.');
    });

    test('Refreshing the page retains the selection', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');
        await page.click('[data-testid="file-item"]:has-text("file1.adoc")');
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc');

        // Reload without skip_restore to test retention
        await page.goto('/');

        // Wait for restoration
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc'); // Filename should appear

        // Content should match
        await expect(async () => {
            const editorContent = await getEditorContent(page);
            // Should be original content if no edits
            expect(editorContent).toBe('== File 1\nContent of file 1.');
        }).toPass();
    });

    test('Nested directory states are persisted correctly', async ({ page }) => {
        // Setup deep structure in tempDir1
        const level1 = path.join(fsSetup.tempDir1, 'level1');
        const level2 = path.join(level1, 'level2');
        const level3 = path.join(level2, 'level3');
        fs.mkdirSync(level3, { recursive: true });
        fs.writeFileSync(path.join(level3, 'deep_file.adoc'), '== Deep File');

        // Refresh file explorer by opening folder again (or just start here)
        await page.click('[data-testid="open-folder-button"]');

        // Verify initial state: All expanded by default
        // level1 visible in Sidebar
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'level1' })).toBeVisible();
        // level2 visible
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'level2' })).toBeVisible();
        // level3 visible
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'level3' })).toBeVisible();
        // deep_file visible
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'deep_file.adoc' })).toBeVisible();

        // Collapse level3. (State: level1=Open, level2=Open, level3=Collapsed)
        await page.click('[data-testid="directory-item"]:has-text("level3") [data-testid="toggle-directory-btn"]');
        // deep_file should hide
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'deep_file.adoc' })).not.toBeVisible();

        // Collapse level1. (State: level1=Collapsed, level2=? (hidden), level3=Collapsed)
        await page.click('[data-testid="directory-item"]:has-text("level1") [data-testid="toggle-directory-btn"]');
        // level2 should hide
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'level2' })).not.toBeVisible();

        // Simulate reload without skip_restore
        await page.goto('/');

        // Wait for restoration
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'level1' })).toBeVisible();

        // Verify level1 is collapsed immediately after load
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'level2' })).not.toBeVisible();

        // Expand level1
        await page.click('[data-testid="directory-item"]:has-text("level1") [data-testid="toggle-directory-btn"]');

        // Verify level2 is visible and expanded (children visible)
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'level2' })).toBeVisible();
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'level3' })).toBeVisible();

        // Verify level3 is visible but collapsed (children NOT visible)
        // deep_file should still be hidden
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'deep_file.adoc' })).not.toBeVisible();
    });

    // New File Feature Tests

    test('Creating a new file from Title Bar', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');
        // Wait for file tree to load
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'file1.adoc' })).toBeVisible();

        const title = await page.locator('[data-testid="new-file-button-titlebar"]').getAttribute('title');
        expect(title).toBe('New File in dir1');

        // Initially in root, no file selected.
        // Click New File button in Title Bar.
        await page.click('[data-testid="new-file-button-titlebar"]');

        // Should create new-1.adoc
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-1');

        // Check file exists on disk
        const newFilePath = path.join(fsSetup.tempDir1, 'new-1');
        expect(fs.existsSync(newFilePath)).toBe(true);

        // Check sidebar has new file selected
        await expect(page.locator('[data-testid="file-item"][data-file-path="new-1"]')).toBeVisible();

        // File should be in rename mode
        await expect(page.locator('[data-testid="file-item"][data-file-path="new-1"] [data-testid="rename-input"]')).toBeVisible();
    });

    test('Creating multiple new files increments counter', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'file1.adoc' })).toBeVisible();

        await page.click('[data-testid="new-file-button-titlebar"]');
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-1');

        // Allow some time for state to settle/save
        await page.waitForTimeout(500);

        await page.click('[data-testid="new-file-button-titlebar"]');
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-2');

        const path1 = path.join(fsSetup.tempDir1, 'new-1');
        const path2 = path.join(fsSetup.tempDir1, 'new-2');
        expect(fs.existsSync(path1)).toBe(true);
        expect(fs.existsSync(path2)).toBe(true);
    });

    test('Creating new file auto-saves current dirty file', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');
        await page.click('[data-testid="file-item"]:has-text("file1.adoc")');
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('file1.adoc');

        // Disable auto-save
        await disableAutoSave(page);

        // Edit
        await setEditorContent(page, 'Modified content.');
        await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();

        // Create new file
        await page.click('[data-testid="new-file-button-titlebar"]');
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-1');

        // Check existing file content
        const content = fs.readFileSync(path.join(fsSetup.tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('Modified content.');
    });

    test('Creating new file in subdirectory via Sidebar', async ({ page }) => {
        await page.click('[data-testid="open-folder-button"]');

        // Expand subdirectory if needed (it is empty so might show as empty)
        // wait for sidebar items
        await expect(page.locator('[data-testid="directory-item"]', { hasText: 'subdir' })).toBeVisible();

        // We select based on 'subdir' text, finding the parent container
        const subdirItem = page.locator('[data-testid="directory-item"]', { hasText: 'subdir' });



        // Right click to open context menu
        await subdirItem.click({ button: 'right' });

        const newFileBtn = page.locator('[data-testid="ctx-new-file"]');
        await expect(newFileBtn).toBeVisible();

        // Click New File in context menu
        await newFileBtn.click();

        // Should create new-1.adoc INSIDE subdir
        const newFilePath = path.join(fsSetup.tempDir1, 'subdir', 'new-1');

        // Allow operation to complete
        await expect(async () => {
            expect(fs.existsSync(newFilePath)).toBe(true);
        }).toPass();

        // Check it is selected in title bar
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('new-1');

        // Verify TitleBar tooltip updates to subdirectory
        // Since we refactored title bar to use data-testid, querying by title is fine for check, or use data-testid
        // The title updates dynamically, so checking attribute on data-testid element is better
        await expect(page.locator('[data-testid="new-file-button-titlebar"]')).toHaveAttribute('title', 'New File in dir1/subdir');
    });

});
