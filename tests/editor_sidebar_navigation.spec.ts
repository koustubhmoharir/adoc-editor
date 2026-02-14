import { helpers, test, expect } from './fixtures.ts';
import { expectMonacoEditorToBeFocused, loadInitialDirectory } from './helpers/sidebar_helpers.ts';

test.beforeEach(async ({ fsSetup }) => {
    // Create a file structure for testing
    // root/
    //   dir-a/
    //     subdir1/
    //       file3.adoc
    //     file2.adoc
    //   dir-b/
    //     file4.adoc
    //   file1.adoc

    fsSetup.cleanup();

    fsSetup.createFile('dir1', 'file1.adoc', 'Content of file 1');
    fsSetup.createFile('dir1', 'dir-a/file2.adoc', 'Content of file 2');
    fsSetup.createFile('dir1', 'dir-a/subdir1/file3.adoc', 'Content of file 3');
    fsSetup.createFile('dir1', 'dir-b/file4.adoc', 'Content of file 4');
});

test('Directory Selection and Expansion', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');
    // Use regex for exact match to avoid matching subdir1
    const dira = page.locator('[data-testid="directory-item"][data-dir-path="dir-a"]');
    const toggleBtn = dira.locator('[data-testid="toggle-directory-btn"]');
    const fileInDir = page.locator('[data-testid="file-item"][data-file-path="dir-a/file2.adoc"]');

    // Initial state: Expanded (Default behavior seems to be expanded)
    await expect(fileInDir).toBeVisible();

    // Click row: Selects ONLY (Does not toggle)
    await dira.click();
    await expect(dira).toHaveAttribute('data-selected', 'true');
    await expect(fileInDir).toBeVisible(); // Still Expanded

    // Click toggle button: Collapses and Selects
    await toggleBtn.click();
    await expect(dira).toHaveAttribute('data-selected', 'true');
    await expect(fileInDir).not.toBeVisible();

    // Click toggle button again: Expands
    await toggleBtn.click();
    await expect(fileInDir).toBeVisible();
});

test('Keyboard Navigation (Arrows)', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');
    // Tree Order: dir-a, dir-b, file1.adoc
    const file1 = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');

    // Focus file1 (bottom of list)
    await file1.click();
    await expect(file1).toBeFocused();

    // This test is flaky because we focus in a normal effect, not in a layout effect.

    await page.keyboard.press('ArrowUp');
    const file4 = page.locator('[data-testid="file-item"][data-file-path="dir-b/file4.adoc"]');
    await expect(file4).toBeFocused();

    // Arrow Up -> Selects dir-b
    await page.keyboard.press('ArrowUp');
    const dirb = page.locator('[data-testid="directory-item"][data-dir-path="dir-b"]');
    await expect(dirb).toHaveAttribute('data-selected', 'true');
    await expect(dirb).toBeFocused();

    // 4 Arrow Up -> Selects dir-a
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    const dira = page.locator('[data-testid="directory-item"][data-dir-path="dir-a"]');
    await expect(dira).toBeFocused();

    // Arrow Down -> Selects subdir1 (inside dir-a)
    const subdir1 = page.locator('[data-testid="directory-item"][data-dir-path="dir-a/subdir1"]');
    await page.keyboard.press('ArrowDown');
    await expect(subdir1).toBeFocused();

    // Arrow Left -> Collapse subdir1
    await page.keyboard.press('ArrowLeft');
    // Arrow Left -> Selects parent (dir-a)
    await page.keyboard.press('ArrowLeft');
    await expect(dira).toBeFocused();

    // Arrow Left again -> Collapses dira
    await page.keyboard.press('ArrowLeft');
    await expect(subdir1).not.toBeVisible();

    // Arrow Right -> Expands dir-a
    await page.keyboard.press('ArrowRight');
    await expect(subdir1).toBeVisible();
});

test('Debounced File Loading @OwnContext', async ({ browser, fsSetup }) => {
    // This test is special because it installs a clock and cannot run on the shared page without messing with other tests
    // Hence we create a new context here and must close it regardless of test status.
    const context = await browser.newContext();
    try {
        const page = await context.newPage();
        await page.clock.install();
        await helpers.setupNewPage(page, {fsSetup});
        await loadInitialDirectory(page, 'dir1');

        const file1 = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');

        // Select file1 (bottom of list) - Loads immediately on click
        await file1.click();
        await expect(file1).toBeFocused();
        await expect(page.locator('.monaco-editor')).toContainText('Content of file 1');

        // Navigate UP to file4 (child of dir-b) - Keyboard selection triggers debounce
        await page.keyboard.press('ArrowUp');
        const file4 = page.locator('[data-testid="file-item"][data-file-path="dir-b/file4.adoc"]');
        await expect(file4).toBeFocused();

        // Verify content NOT changed (debounce) - Still file 1 content
        await page.clock.fastForward(100);
        await expect(page.locator('.monaco-editor')).toContainText('Content of file 1');

        // Navigate UP twice to file2 (child of dir-a) - Keyboard selection triggers debounce
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        const file2 = page.locator('[data-testid="file-item"][data-file-path="dir-a/file2.adoc"]');
        await expect(file2).toBeFocused();

        // Verify content NOT changed (debounce) - Still file 1 content
        await page.clock.fastForward(100);
        await expect(page.locator('.monaco-editor')).toContainText('Content of file 1');

        // Exceed debounce (750ms totals)
        await page.clock.fastForward(800);
        await expect(page.locator('.monaco-editor')).toContainText('Content of file 2');
    }
    finally {
        context.close();
    }
});

test('Enter Navigation (File)', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');
    const file1 = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
    await file1.click();
    await expect(file1).toBeFocused();

    // Press Enter
    await page.keyboard.press('Enter');

    // Verify Editor is focused
    expectMonacoEditorToBeFocused(page);
});

test('Space/Enter Navigation (Directory)', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');
    const dira = page.locator('[data-testid="directory-item"][data-dir-path="dir-a"]');
    await dira.click(); // select only
    await expect(dira).toHaveAttribute('data-selected', 'true');

    // Check initial state (expanded) - file2 visible
    const file2 = page.locator('[data-testid="file-item"][data-file-path="dir-a/file2.adoc"]');
    await expect(file2).toBeVisible();

    // Press Enter -> Collapse
    await page.keyboard.press('Enter');
    await expect(file2).not.toBeVisible();

    // Press Enter -> Expand
    await page.keyboard.press('Enter');
    await expect(file2).toBeVisible();

    // Press Space -> Collapse
    await page.keyboard.press(' ');
    await expect(file2).not.toBeVisible();
});

test('Escape Navigation', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');
    const file1 = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
    await file1.click();
    await expect(file1).toBeFocused();

    // Explicitly focus editor (click content)
    await page.locator('.monaco-editor').click();

    // Press Escape
    await page.keyboard.press('Escape');

    // Verify sidebar file item (file1) is focused
    await expect(file1).toBeFocused();
});
test('Double Click Navigation', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');
    const file1 = page.locator('[data-testid="file-item"][data-file-path="file1.adoc"]');
    const dira = page.locator('[data-testid="directory-item"][data-dir-path="dir-a"]');
    const fileInDir = page.locator('[data-testid="file-item"][data-file-path="dir-a/file2.adoc"]');

    // Double Click File
    await file1.dblclick();

    // Verify Editor is focused
    const monaco = await expectMonacoEditorToBeFocused(page);
    await expect(monaco).toContainText('Content of file 1');

    // Double Click Directory (Toggle)
    // Initial state: Expanded -> fileInDir visible
    await expect(fileInDir).toBeVisible();

    await dira.dblclick();
    await expect(fileInDir).not.toBeVisible();

    await dira.dblclick();
    await expect(fileInDir).toBeVisible();
});

test('should navigate to root node with arrow keys', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    // Select dir-a (first child of root)
    const dira = page.locator('[data-testid="directory-item"][data-dir-path="dir-a"]');
    await dira.click();
    await expect(dira).toHaveAttribute('data-selected', 'true');

    // Press ArrowUp to reach root
    await page.keyboard.press('ArrowUp');

    const rootItem = page.locator('[data-dir-path=""]');
    await expect(rootItem).toHaveAttribute('data-selected', 'true');
});

test('should toggle root node collapse/expand with Left/Right keys', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    // Select root
    const rootItem = page.locator('[data-dir-path=""]');
    await rootItem.click();
    await expect(rootItem).toHaveAttribute('data-selected', 'true');

    // Ensure it starts expanded (default) - Check if "dir-a" is visible
    const dira = page.locator('[data-testid="directory-item"][data-dir-path="dir-a"]');
    await expect(dira).toBeVisible();

    // 3. Press ArrowLeft -> Should collapse
    await page.keyboard.press('ArrowLeft');

    // Verify collapsed state - dir-a should NOT be visible
    await expect(dira).not.toBeVisible();

    // 4. Press ArrowRight -> Should expand
    await page.keyboard.press('ArrowRight');
    await expect(dira).toBeVisible();
});

test('should navigate from root to first child with ArrowRight', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    // Select root
    const rootItem = page.locator('[data-dir-path=""]');
    await rootItem.click();

    // Navigate Right (already expanded) -> First child (dir-a)
    await page.keyboard.press('ArrowRight');

    const dira = page.locator('[data-testid="directory-item"][data-dir-path="dir-a"]');
    await expect(dira).toHaveAttribute('data-selected', 'true');
});
